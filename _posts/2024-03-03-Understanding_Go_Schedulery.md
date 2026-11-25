---
title: "Understanding Go Scheduler"
date: 2024-03-03T22:00:00-04:00
categories:
  - blog
tags:
  - Concurrency
  - Go
---

Launching a goroutine in Go is simple:

```go
go processRequest(request)
```

But what happens after that statement?

A goroutine doesn't automatically get its own operating system thread. The Go runtime decides when and where it executes, how it competes for CPU time, and what happens when it blocks.

Understanding these decisions is important when building high-throughput services, worker pools, and concurrent backend systems.

At the center of Go's concurrency model is the **G-M-P scheduler**.

## 1. Understanding G, M, and P

The Go scheduler coordinates three core entities.

**G — Goroutine**

A G represents a goroutine: the unit of work scheduled by the Go runtime.

It contains execution state such as its stack, instruction pointer, and scheduling information. Goroutines start with relatively small stacks that can grow as needed.

**M — Machine**

An M represents an operating system thread.

It is the actual thread that executes Go code. The runtime manages Ms and can create additional threads when necessary, including when existing threads become blocked.

**P — Processor**

A P represents the resources and runtime state required to execute Go code.

An M must have a P associated with it to execute Go code. Each P also maintains a local run queue of runnable goroutines.

The number of Ps is controlled by `GOMAXPROCS`.

A P is not a physical CPU core. It is a logical runtime resource that determines how many goroutines can execute Go code simultaneously.

## 2. How the scheduler brings them together

Think of the three components this way:

- G represents the work.
- M represents the operating system thread.
- P represents the execution resources required by the runtime.

A simplified execution flow looks like this:

1. An application creates a goroutine.
2. The runtime makes the goroutine runnable and places it in a run queue.
3. An M acquires an available P.
4. The M executes a goroutine scheduled by that P.
5. When the goroutine completes, blocks, or yields, the scheduler determines what runs next.

The relationship is not permanently one-to-one. An M can execute many goroutines over time, and a P can be associated with different Ms as scheduling conditions change.

This separation allows Go to multiplex a large number of goroutines over a smaller number of operating system threads.

Let's observe this behaviour with a small example:

```go
package main

import (
	"fmt"
	"runtime"
	"sync"
)

func main() {
	runtime.GOMAXPROCS(2)

	var wg sync.WaitGroup

	for i := 1; i <= 5; i++ {
		wg.Add(1)

		go func(id int) {
			defer wg.Done()
			fmt.Printf("Goroutine %d running\n", id)
		}(i)
	}

	wg.Wait()
}
```

We create five goroutines but configure the runtime to use at most two Ps for simultaneous Go code execution.

The goroutines are not assigned dedicated threads. The runtime schedules them across the available execution resources.

Notice that the output order is not guaranteed. The scheduler determines execution order based on runtime conditions.

## 3. Local and global run queues

The Go scheduler uses both local and global run queues.

**Local run queue**

Each P has a local run queue containing runnable goroutines.

Keeping runnable work close to the P reduces contention and helps the scheduler make efficient scheduling decisions.

**Global run queue**

The runtime also maintains a global run queue.

Runnable goroutines can enter this queue, and Ps periodically check it for work.

The scheduler doesn't pull every goroutine from one shared queue. Local queues allow Ps to manage much of their work independently, reducing contention around a single scheduling structure.

This becomes particularly important when an application has a large number of concurrent workloads.

## 4. Work stealing: keeping processors busy

What happens when one P runs out of work while another has a backlog?

This is where **work stealing** becomes important.

A P with no runnable goroutines can attempt to find work elsewhere. It may steal runnable goroutines from another P's local run queue.

Consider a backend service processing requests:

- P1 receives several CPU-intensive tasks.
- P2 finishes its current work and becomes idle.
- P2 attempts to find additional runnable work.
- It may steal work from P1 rather than remaining idle.

This helps balance workloads across available processors.

Work stealing doesn't guarantee perfectly balanced execution, but it helps reduce idle processors when runnable work is available elsewhere.

## 5. What happens when a goroutine blocks?

Blocking is a normal part of backend applications.

A goroutine might wait for:

- Network I/O
- A database response
- A channel operation
- A mutex
- A system call

The scheduler's response depends on what caused the block.

For example, when a goroutine waits for network I/O managed by Go's network poller, the runtime can park that goroutine and schedule another runnable goroutine.

When the network operation becomes ready, the goroutine can be made runnable again.

System calls require a different consideration. If an M becomes blocked in a system call, the runtime can detach its P and make that P available to another M so other goroutines can continue executing.

We can observe the basic idea of a parked goroutine with a simple example:

```go
package main

import (
	"fmt"
	"time"
)

func main() {
	go func() {
		fmt.Println("Goroutine 1: waiting...")
		time.Sleep(2 * time.Second)
		fmt.Println("Goroutine 1: resumed")
	}()

	go func() {
		fmt.Println("Goroutine 2: doing other work")
	}()

	time.Sleep(3 * time.Second)
}
```

While the first goroutine is sleeping, it is not consuming a P to execute Go code. The runtime can schedule other runnable goroutines.

`time.Sleep` is a convenient demonstration of parking, although it is different from network polling or a blocking system call.

This is one reason Go can support large numbers of I/O-bound goroutines without requiring an equivalent number of operating system threads.

## 6. Preemption: why goroutines don't run forever

A scheduler needs a way to prevent one goroutine from monopolizing execution.

Go supports asynchronous preemption, introduced in Go 1.14, allowing the runtime to interrupt goroutines that run for too long without reaching a function call or another suitable scheduling point.

Imagine a service with one goroutine performing a large computation while other goroutines are ready to process incoming requests.

Without effective preemption, the CPU-intensive goroutine could delay other work.

Preemption gives the runtime more opportunities to schedule other runnable goroutines.

It does not mean every goroutine receives an identical amount of CPU time or that scheduling latency is strictly bounded.

## 7. Understanding GOMAXPROCS

`GOMAXPROCS` controls the maximum number of Ps that can execute Go code simultaneously.

Let's inspect the current runtime configuration:

```go
package main

import (
	"fmt"
	"runtime"
)

func main() {
	fmt.Println("Logical CPUs:", runtime.NumCPU())
	fmt.Println("GOMAXPROCS:", runtime.GOMAXPROCS(0))
}
```

Here:

- `runtime.NumCPU()` reports the logical CPU count available to the process.
- `runtime.GOMAXPROCS(0)` reports the current GOMAXPROCS setting without changing it.

For example, setting:

```go
runtime.GOMAXPROCS(4)
```

allows up to four goroutines to execute Go code simultaneously.

It does not limit the total number of goroutines or operating system threads.

A service can have thousands of goroutines while using only a few Ps for Go code execution.

Modern Go versions also have runtime behaviour for selecting GOMAXPROCS based on available CPU resources and container limits. Therefore, the effective default can depend on the environment and Go version.

Increasing GOMAXPROCS does not automatically improve throughput. The result depends on workload characteristics, CPU availability, contention, and the amount of parallelizable work.

Measure before changing it.

## 8. Observing scheduler behaviour with runtime tracing

Understanding the scheduler conceptually is useful. Being able to observe it in a running application is even more valuable.

Go provides the `runtime/trace` package to capture execution traces.

Here's a minimal example:

```go
package main

import (
	"os"
	"runtime/trace"
)

func main() {
	f, err := os.Create("trace.out")
	if err != nil {
		panic(err)
	}
	defer f.Close()

	if err := trace.Start(f); err != nil {
		panic(err)
	}
	defer trace.Stop()

	// Run application workload here.
}
```

After running the program, inspect the trace:

```bash
go run .
go tool trace trace.out
```

The execution trace helps visualize:

- Goroutine scheduling and execution.
- Processor utilization.
- Blocking and unblocking events.
- Network and system call activity.
- Scheduler latency.

For a production service, this can help investigate questions such as:

- Are goroutines spending too much time waiting?
- Are available Ps consistently busy?
- Are CPU-intensive tasks delaying other work?
- Is blocking or scheduling contributing to request latency?

Runtime tracing moves the discussion from assumptions to observable behaviour.

## 9. What this means for production systems

Understanding the scheduler changes how we approach concurrency in production.

**More goroutines do not always mean more throughput.**

If a service creates unbounded goroutines for incoming requests, it can accumulate work faster than it can process it. The scheduler can distribute runnable goroutines, but it cannot create additional CPU capacity.

**Blocking and CPU-bound workloads behave differently.**

A service waiting on network responses has different scheduling characteristics from one performing CPU-intensive calculations.

**Concurrency limits are still necessary.**

Worker pools, bounded queues, request limits, and backpressure help control how much work enters a system.

**GOMAXPROCS is not a universal performance knob.**

Tune it based on actual workload measurements rather than assuming that more Ps always produce better results.

The scheduler helps execute concurrent workloads efficiently. It does not replace sound application-level concurrency design.

## Conclusion

The G-M-P model explains how Go executes thousands of goroutines without requiring thousands of operating system threads.

Goroutines represent work, Ms provide operating system execution threads, and Ps provide the runtime resources required to execute Go code.

Local run queues, work stealing, blocking management, and preemption allow the runtime to coordinate that work efficiently.

For backend engineers, the important takeaway is that goroutines are lightweight, but execution resources are still finite.

Understanding the scheduler helps us design concurrency deliberately, diagnose performance bottlenecks, and build services that make better use of available resources.

### What's next?

In Part 3, we'll move from runtime internals to application architecture:

**Building High-Throughput Worker Pools in Go**

We'll explore bounded concurrency, queue design, backpressure, cancellation, and the trade-offs involved in building worker pools for production services.

---

*Further reading:*

- [Go Runtime Scheduler Source](https://go.dev/src/runtime/proc.go)
- [Go Runtime Documentation](https://pkg.go.dev/runtime)
- [Go Execution Tracer](https://pkg.go.dev/runtime/trace)
- [Go 1.14 Release Notes — Runtime](https://go.dev/doc/go1.14#runtime)