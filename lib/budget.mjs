// Bounds on solver work.
//
// The primary bound is a node budget, which is deterministic: the same
// instance exhausts it at the same point on every run and every machine, so a
// verdict reached inside the budget is reproducible. A wall-clock deadline sits
// behind it purely as a backstop against a pathological case that the node
// counter somehow fails to bound.
//
// Exhausting either bound raises BudgetExceeded. A caller must treat that as a
// rejection. It is never a pass.

export class BudgetExceeded extends Error {
  constructor(kind, limit) {
    super(`budget exceeded: ${kind} limit ${limit}`);
    this.name = 'BudgetExceeded';
    this.kind = kind;
    this.limit = limit;
  }
}

export class Budget {
  constructor({ nodes = 2_000_000, ms = 20_000 } = {}) {
    this.nodeLimit = nodes;
    this.msLimit = ms;
    this.nodes = 0;
    this.started = Date.now();
    this._checkIn = 0;
  }

  tick(n = 1) {
    this.nodes += n;
    if (this.nodes > this.nodeLimit) throw new BudgetExceeded('nodes', this.nodeLimit);
    // Checking the clock is relatively expensive; do it every 4096 nodes.
    if ((this._checkIn = (this._checkIn + 1) & 4095) === 0) {
      if (Date.now() - this.started > this.msLimit) throw new BudgetExceeded('ms', this.msLimit);
    }
  }

  get elapsedMs() { return Date.now() - this.started; }
}
