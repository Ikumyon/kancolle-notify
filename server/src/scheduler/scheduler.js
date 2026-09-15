import { Repository } from '../repository/repository.js';
import { nextDeliveryAt } from '../domain/state.js';
import { route } from '../api/router.js';
import { dispatch } from '../notify/dispatcher.js';

export class NotificationScheduler {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.serial = Promise.resolve();
  }

  run(fn) {
    const result = this.serial.then(fn);
    this.serial = result.catch(() => {});
    return result;
  }

  async schedule() {
    const { state } = await new Repository(this.env.DB).read();
    const next = nextDeliveryAt(state, Date.now());
    if (next === null) {
      await this.ctx.storage.deleteAlarm();
    } else {
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, next));
    }
  }

  fetch(request) {
    return this.run(async () => {
      // D1更新と予約更新の途中で停止した場合の復旧用。正常終了時は本来の予約に置き換える。
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      const response = await route(request, this.env);
      await this.schedule();
      return response;
    });
  }

  alarm() {
    return this.run(async () => {
      await this.ctx.storage.setAlarm(Date.now() + 60000);
      await dispatch(this.env);
      await this.schedule();
    });
  }
}
