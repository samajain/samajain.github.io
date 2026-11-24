---
title: "Building High-Throughput Worker Pools in Go"
date: 2024-03-13T22:00:00-04:00
categories:
  - blog
tags:
  - Concurrency
  - Go
---

# Building High-Throughput Worker Pools in Go

Goroutines make concurrency in Go remarkably accessible. Creating thousands of goroutines is relatively inexpensive, and the Go scheduler does a good job of managing their execution.

But inexpensive doesn't mean unlimited.

Imagine a backend service receiving 10,000 requests, each triggering a background operation. If every request creates a new goroutine, the application may accumulate more work than its CPU, database connections, or downstream services can handle.

The problem isn't necessarily the number of goroutines. It's the lack of control over how much work executes simultaneously.

This is where **worker pools** become useful.

A worker pool allows an application to process many tasks concurrently while keeping the number of active workers bounded.

In this article, we'll build one incrementally and explore the design decisions that matter in production systems.

## 1. The problem with unbounded concurrency

Consider a service that processes incoming jobs by starting a goroutine for each one:

```go
func processJobs(jobs []Job) {
    for _, job := range jobs {
        go process(job)
    }
}
```

This is simple, but it introduces several problems:

- There is no limit on concurrent execution.
- A sudden increase in traffic can create thousands of active goroutines.
- Each goroutine consumes memory and potentially holds resources.
- Downstream dependencies may become overwhelmed.
- The application has no built-in mechanism for applying backpressure.

The Go scheduler can manage goroutines efficiently, but it cannot create additional CPU capacity or database connections.

For example, if every job makes a database request, creating 5,000 goroutines doesn't mean the database can efficiently handle 5,000 concurrent queries.

We need a way to control concurrency independently of incoming workload.

## 2. Introducing the worker pool pattern

A worker pool separates job submission from job execution.

Instead of creating a goroutine for every job, we create a fixed number of workers. Each worker continuously retrieves jobs from a shared channel and processes them.

The architecture has three components:

1. **Producer:** Creates or receives jobs.
2. **Job queue:** Holds pending work.
3. **Workers:** Consume and process jobs concurrently.

For example, a pool with four workers can process at most four jobs simultaneously, assuming each worker processes one job at a time.

<escape>```text
                Incoming Jobs
                      |
                      v
                +-----------+
                | Producer  |
                +-----------+
                      |
                      v
                +-----------+
                | Job Queue |
                +-----------+
                 /   |   |   
                v    v   v    v
              W1    W2  W3   W4
                \    |   |   /
                 v   v   v  v
               Processed Jobs
```</escape>

The queue decouples job submission from execution, while the fixed worker count controls concurrency.

Let's implement this in Go.

## 3. Building a basic worker pool

First, define a job:

```go
type Job struct {
    ID int
}
```

Next, implement a worker that reads jobs from a channel:

```go
func worker(id int, jobs <-chan Job, wg *sync.WaitGroup) {
    defer wg.Done()

    for job := range jobs {
        fmt.Printf("Worker %d processing job %d\n",
            id, job.ID)

        process(job)
    }
}
```

The worker continuously reads from the channel until it is closed.

Now we can create a fixed number of workers and distribute jobs among them:

```go
func main() {
    const workerCount = 4

    jobs := make(chan Job)
    var wg sync.WaitGroup

    for i := 1; i <= workerCount; i++ {
        wg.Add(1)
        go worker(i, jobs, &wg)
    }

    for i := 1; i <= 20; i++ {
        jobs <- Job{ID: i}
    }

    close(jobs)
    wg.Wait()
}
```

Here, we create four workers and submit twenty jobs.

The important distinction is that we create four goroutines for execution, not twenty.

The producer sends jobs into the channel, and the workers compete to receive them. Once the channel is closed, workers finish processing the remaining jobs and exit.

`sync.WaitGroup` ensures that the main function waits for all workers to finish.

This is a good starting point, but production systems need to handle more than job distribution.

## 4. Bounded queues and backpressure

The previous example uses an unbuffered channel:

```go
jobs := make(chan Job)
```

An unbuffered channel requires a sender and receiver to synchronize on each send.

This means the producer waits until a worker is ready to receive the next job.

We can introduce a bounded buffer:

```go
jobs := make(chan Job, 100)
```

Now the queue can hold up to 100 pending jobs.

The behaviour becomes:

- Workers process jobs concurrently.
- The producer can submit jobs without waiting for an immediate receiver.
- When the queue reaches capacity, the producer blocks until space becomes available.

This is an important concept: **backpressure**.

Backpressure prevents a producer from continuously submitting work faster than consumers can process it.

Without a bounded queue, an application may accumulate an enormous backlog, increasing memory consumption and processing latency.

A bounded channel provides a simple form of backpressure because sending to a full channel blocks.

However, queue capacity is an architectural decision.

A larger queue can absorb short bursts of traffic, but it also allows more pending work to accumulate. A smaller queue applies pressure sooner but may cause producers to wait more frequently.

The right capacity depends on job size, processing time, arrival rate, and latency requirements.

## 5. Making the worker pool cancellation-aware

Our current worker pool has another limitation: workers cannot respond to application shutdown or request cancellation.

In production, workers should be able to stop accepting new work when the application is shutting down.

Go's `context.Context` provides a standard mechanism for propagating cancellation and deadlines.

We can update the worker:

```go
func worker(
    ctx context.Context,
    id int,
    jobs <-chan Job,
    wg *sync.WaitGroup,
) {
    defer wg.Done()

    for {
        select {
        case <-ctx.Done():
            return

        case job, ok := <-jobs:
            if !ok {
                return
            }

            if ctx.Err() != nil {
                return
            }

            if err := process(ctx, job); err != nil {
                log.Printf(
                    "worker %d failed processing job %d: %v",
                    id, job.ID, err,
                )
            }
        }
    }
}
```

The worker now listens for cancellation while waiting for work.

The processing function also receives the context:

```go
func process(ctx context.Context, job Job) error {
    select {
    case <-ctx.Done():
        return ctx.Err()

    case <-time.After(100 * time.Millisecond):
        fmt.Printf("Processed job %d\n", job.ID)
        return nil
    }
}
```

This is a simplified example. Real processing functions must propagate the context into operations such as HTTP requests and database queries.

One important distinction: cancellation is cooperative. The context signals that work should stop; it does not forcibly terminate a goroutine.

## 6. Handling errors and coordinating shutdown

Cancellation alone isn't enough.

What happens when a worker encounters a processing error? Should it continue? Should the entire pool stop? Should the job be retried?

These are application-level decisions.

For a simple fail-fast worker pool, we can cancel the remaining work when the first processing error occurs.

The following implementation brings together bounded concurrency, cancellation, error propagation, and worker coordination.

```go
package main

import (
    "context"
    "fmt"
    "log"
    "sync"
    "time"
)

type Job struct {
    ID int
}

func process(ctx context.Context, job Job) error {
    select {
    case <-ctx.Done():
        return ctx.Err()

    case <-time.After(100 * time.Millisecond):
        fmt.Printf("Processed job %d\n", job.ID)
        return nil
    }
}

func runWorkerPool(
    parent context.Context,
    jobs []Job,
    workerCount int,
    queueSize int,
) error {
    if workerCount < 1 || queueSize < 0 {
        return fmt.Errorf("invalid worker or queue configuration")
    }

    ctx, cancel := context.WithCancel(parent)
    defer cancel()

    jobQueue := make(chan Job, queueSize)

    var wg sync.WaitGroup
    var once sync.Once
    var firstErr error

    reportError := func(err error) {
        once.Do(func() {
            firstErr = err
            cancel()
        })
    }

    for i := 1; i <= workerCount; i++ {
        wg.Add(1)

        go func(id int) {
            defer wg.Done()

            for {
                if ctx.Err() != nil {
                    return
                }

                select {
                case <-ctx.Done():
                    return

                case job, ok := <-jobQueue:
                    if !ok {
                        return
                    }

                    if ctx.Err() != nil {
                        return
                    }

                    if err := process(ctx, job); err != nil {
                        if ctx.Err() == nil {
                            reportError(
                                fmt.Errorf(
                                    "worker %d, job %d: %w",
                                    id, job.ID, err,
                                ),
                            )
                        }
                        return
                    }
                }
            }
        }(i)
    }

sendJobs:
    for _, job := range jobs {
        select {
        case <-ctx.Done():
            break sendJobs

        case jobQueue <- job:
        }
    }

    close(jobQueue)
    wg.Wait()

    if firstErr != nil {
        return firstErr
    }

    return ctx.Err()
}

func main() {
    jobs := make([]Job, 20)

    for i := range jobs {
        jobs[i] = Job{ID: i + 1}
    }

    ctx, cancel := context.WithTimeout(
        context.Background(),
        5*time.Second,
    )
    defer cancel()

    if err := runWorkerPool(ctx, jobs, 4, 8); err != nil {
        log.Printf("worker pool stopped: %v", err)
    }
}
```

Let's look at the important design decisions.

**Bounded execution**

Only four worker goroutines are created. Each processes one job at a time, limiting active processing to four jobs.

**Bounded queue**

The channel holds at most eight pending jobs. When full, the producer waits for workers to make room.

**Cancellation propagation**

The context allows workers and processing operations to respond to cancellation.

**Error coordination**

`sync.Once` ensures that only the first processing error is recorded and triggers cancellation.

**Graceful coordination**

The producer stops submitting work when the context is canceled, closes the queue, and waits for workers to exit.

This is a fail-fast example, not a universal production implementation. Some systems should continue processing other jobs after an individual failure, collect multiple errors, or retry failed jobs. Also, the example receives jobs as a slice; a real service may need a streaming producer rather than keeping all jobs in memory.

## 7. Choosing the right number of workers

One of the most important worker-pool configuration decisions is the worker count.

Should we create four workers? Forty? Four hundred?

There isn't a universal answer.

It depends on the workload.

**CPU-bound workloads**

For CPU-intensive work such as compression, image processing, or cryptographic calculations, concurrency is constrained by available CPU capacity.

A reasonable starting point is to benchmark around the effective `GOMAXPROCS` value and adjust based on throughput and latency.

Adding more workers beyond available CPU capacity may increase scheduling overhead and contention without improving throughput.

**I/O-bound workloads**

For operations such as database queries, HTTP calls, or object storage requests, workers spend significant time waiting.

In these cases, the worker count can exceed `GOMAXPROCS` because many workers are waiting rather than actively consuming CPU.

However, the actual limit may be imposed by the downstream service.

For example, a worker pool making database requests should respect connection pool capacity and the database's ability to handle concurrent queries.

The goal is not to maximize the number of workers. It is to maximize useful throughput without overwhelming the system.

## 8. Production considerations

A worker pool is a concurrency-control mechanism, not a complete job-processing platform.

Several additional concerns matter in production.

**Retries and idempotency**

A failed job may need to be retried. But retries can cause duplicate side effects if the operation is not idempotent.

For payment processing, for example, retrying a timed-out operation without checking its outcome could result in duplicate processing. Idempotency keys and durable state are important safeguards.

**Queue durability**

A Go channel exists only in process memory. If the application crashes, pending jobs in that channel are lost.

For work that must survive restarts, consider a durable message broker or persistent job queue.

**Observability**

Track metrics such as:

- Active workers.
- Queue depth.
- Job processing duration.
- Job failure and retry rates.
- Time spent waiting in the queue.
- Cancellation and shutdown counts.

These metrics help identify whether the bottleneck is worker capacity, queue pressure, or a downstream dependency.

**Graceful shutdown**

A production service should stop accepting new work before shutting down workers. It should allow in-flight operations to finish within a defined deadline, then cancel remaining work if necessary.

The worker pool should be part of the application's lifecycle management, not an isolated collection of goroutines.

## Conclusion

Worker pools provide a practical way to control concurrency in Go applications.

They turn an unbounded stream of potential goroutines into a controlled execution model with a fixed number of workers, bounded queues, and explicit cancellation.

But the real value isn't simply reducing goroutine count.

It's controlling how much work enters the system, protecting downstream dependencies, and making application behaviour more predictable under load.

A well-designed worker pool helps a service absorb bursts without allowing concurrency to grow uncontrollably.

### What's next?

In Part 4, we'll explore one of the most important and frequently misunderstood areas of Go concurrency:

**The Go Memory Model: Understanding Happens-Before**

We'll examine data races, memory visibility, synchronization, mutexes, channels, and why concurrent code that appears to work can still be incorrect.

---

*Further reading:*
- [Go Concurrency Patterns: Pipelines and Cancellation](https://go.dev/blog/pipelines)
- [Go Memory Model](https://go.dev/ref/mem)
- [Go sync Package](https://pkg.go.dev/sync)
- [Go context Package](https://pkg.go.dev/context)