export class BaseProvider {
  constructor(name) {
    this.name = name;
  }

  isConfigured(env) {
    throw new Error('not_implemented');
  }

  async send(delivery, env, sendFn = fetch) {
    throw new Error('not_implemented');
  }
}
