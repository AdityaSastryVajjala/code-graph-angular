/** Phase 2 fixture: abstract base class for testing EXTENDS + Class extraction. */

export abstract class BaseService {
  protected readonly tag: string = 'base';

  abstract fetchAll(): Promise<unknown[]>;

  protected log(msg: string): void {
    console.log(`[${this.tag}] ${msg}`);
  }
}
