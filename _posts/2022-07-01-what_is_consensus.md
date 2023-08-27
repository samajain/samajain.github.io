---
title: "What is Consensus?"
date: 2022-07-01T18:00:30-04:00
categories:
  - blog
tags:
  - consensus algorithm
  - protocol
  - distributed systems 
---

A fundamental problem which mares distributed computing is how to attain overall system reliability in the presence of deterministic and non-deterministic faulty processes and conditions which impact the distributed system. If you go by its literal meaning, then a consensus is something which is agreed upon by a group of entities. The same concept applies in distributed computing too. The consensus problem requires agreement by a number of entities (usually processes, servers, agents etc.) on a single data value. Some of the processes participating in the consensus might be faulty or unreliable but the general problem solved by the consensus algorithm in a distributed system is to agree upon a single consensus value despite of the faulty conditions, thus, achieving fault tolerance and resilience.

A simplistic approach for generating a consensus is for all processes to to agree upon a majority value, therefore, at least one more than half the number of participating processes must agree upon a value by voting, where each process gets to vote only once. But this introduces a chance of a faulty or adversary process of skewing the resultant outcome by denying the consensus or worse, reaching a faulty outcome through majority.

Current consensus algorithms are designed to withstand only a limited number of faulty processes participating in the consensus. There is no such algorithm defined (yet!) which can handle any number of faulty processes.

# __How does a Consensus Algorithm work?__

A consensus algorithm must satisfy a number of requirements to be useful into distributed system.
* The output value of a consensus algorithm must have been an input to some process.
* The process can decide on an output value only once and that value remains unchanged till a consensus is reached or the algorithm is restarted!
* A process is correct if it experiences no failures during its execution.

Apart from this, the algorithm must also satisfy the following properties:
* **Termination:**
    Eventually, every correct process must terminate at some point and decide upon a value.
* **Integrity:**
    If all correct processes propose a value w, then some other correct process must also decide on the value w.
* **Agreement:**
    Every correct process must agree upon the same value.
          
When it comes to consensus algorithm, the possibility of solving consensus in a failure-prone distributed environments depends on several factors like:
* **Synchronous and Asynchronous Systems:**
    Are the processes bound by some amount of time which they can take to decide on the next step? Usually, real life consensus problems are asynchronous, but given the complexity of it and the number of factors which could come into play, it’s always easier to model the synchronous systems. For the Synchronous systems, we assume that all communications take place in rounds, where a process can send and receive messages to and from other processes in one round. This way, messages in one round don’t have any impact on the outcomes of the other rounds.
      It is interesting to note, that in a fully asynchronous message passing distributed system, with the possibility of one process crashing, it has been proven by the Fischer, Lynch, and Paterson’s famous FLP impossibility, that achieving consensus through a deterministic algorithm is impossible.
* **Communication Delays:**
    For the processes connected by certain medium, does a bound exist on the time taken for a sent message to be delivered to the recipient process? If so, do all processes involved in the consensus know about this bound?
* **Order of message delivery:**
    Does the order in which messages are sent affect the order in which they are received?
* **Messaging Transmission Type:**
    Whether a process uses unicast or multicast to transmit their results to other participating processes.

![Possibility of Achieving Distributed Consensus](/assets/images/possibility.png){:class="img-responsive"}

So in this post, we discussed what a Consensus is, what a consensus algorithm needs to adhere to and the factors involved in solving a consensus problem in a distributed system. In our next post, we will dive deeper into consensus algorithms and discuss about one of my favorite distributed systems protocol: **[RAFT](https://www.samarthjain.dev/blog/RAFT_protocol/)**.

[comment]: #
[comment]: #Check out the [Jekyll docs][jekyll-docs] for more info on how to get the most out of Jekyll. File all bugs/feature requests at [Jekyll’s GitHub repo][jekyll-gh]. If you have questions, you can ask them on [Jekyll Talk][jekyll-talk].
[comment]: #
[comment]: #[jekyll-docs]: https://jekyllrb.com/docs/home
[comment]: #[jekyll-gh]:   https://github.com/jekyll/jekyll
[comment]: #[jekyll-talk]: https://talk.jekyllrb.com/
