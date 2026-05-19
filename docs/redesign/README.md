# Pi Harness Workflow Redesign

Date: 2026-05-19

This folder captures the proposed redesign of pi-harness from a linear phase
pipeline into a tighter local mission-control runtime.

The goal is performance in the practical sense:

- less wasted agent work
- smaller context windows
- earlier verification
- clearer live output
- stronger safety boundaries
- faster human judgment
- better replay when something goes wrong

## Documents

- [Operating model](./operating-model.md): the redesigned workflow, runtime
  architecture, agent roles, and state model.
- [Pages and user stories](./pages-and-user-stories.md): ASCII wireframes for
  the new dashboard pages, how each page functions, and the user story behind it.

## North Star

The old product shape is:

```text
+---------+-------------+------+--------+----+
| Intake | Brainstorm  | Plan | Code   | PR |
+---------+-------------+------+--------+----+
                              |
                              v
                           Verify
```

The new product shape is:

```text
+-------------------+
| Human Request     |
+---------+---------+
          |
          v
+---------+---------+
| Mission Compiler  |
+---------+---------+
          |
          v
+---------+--------------------------------------------------+
| Context Preflight                                          |
| codebase-scout | risk-scout | test-scout | precedent-scout |
+---------+--------------------------------------------------+
          |
          v
+---------+---------+
| Strategy Gate     |
+---------+---------+
          |
          v
+---------+--------------------------------------------------------------+
| Execution Runtime                                                       |
| workcells + live verifier sidecars + policy kernel + event ledger       |
+---------+--------------------------------------------------------------+
          |
          v
+---------+---------+
| Proof Gate       |
+---------+---------+
          |
          v
+---------+---------+
| Ship / Repair    |
+-------------------+
```

The dashboard should make that shape visible.
