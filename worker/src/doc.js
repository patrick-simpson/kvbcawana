// A small document kept in memory and written through to storage. The Durable
// Object is ONE instance, so memory is the truth while it runs: a
// check-and-set on `data` is one synchronous step (no await between the check
// and the write), which is what makes a claim or a lease atomic. save() then
// writes the document as it stands at that moment; a restarted object loads
// the stored copy.

export class Doc {
  /**
   * @param {{ get(k: string): Promise<any>, put(k: string, v: any): Promise<void>, delete(k: string): Promise<any> }} storage
   * @param {string} key @param {() => any} fresh the empty document
   */
  constructor(storage, key, fresh) {
    this.storage = storage;
    this.key = key;
    this.fresh = fresh;
    /** @type {any} */
    this.data = null;
    /** @type {Promise<void>|null} */
    this.loading = null;
  }

  /** Load the stored copy once. After this, `data` is usable synchronously. */
  load() {
    if (!this.loading) {
      this.loading = (async () => {
        const stored = await this.storage.get(this.key);
        if (this.data === null) this.data = stored ?? this.fresh();
      })();
    }
    return this.loading;
  }

  /** Persist what is in memory now. */
  async save() {
    await this.storage.put(this.key, this.data);
  }

  /** Forget this document (the end of a night). */
  async drop() {
    this.data = this.fresh();
    await this.storage.delete(this.key);
  }
}
