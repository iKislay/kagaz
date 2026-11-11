import { EventEmitter2 } from '@nestjs/event-emitter';
import { describe, expect, it } from 'vitest';
import { DomainEvent, DomainEventBus, type DeviceStatusChangedEvent } from './domain-events.js';

const payload: DeviceStatusChangedEvent = {
  deviceId: 'd',
  shopId: 's',
  online: true,
  at: '2026-01-01T00:00:00.000Z',
};

describe('DomainEventBus', () => {
  it('queues events published on a transaction until flush (commit)', () => {
    const emitter = new EventEmitter2();
    const bus = new DomainEventBus(emitter);
    const got: unknown[] = [];
    emitter.on(DomainEvent.DEVICE_STATUS_CHANGED, (e) => got.push(e));

    const tx = {};
    const queue = bus.open(tx);
    bus.publish(tx, DomainEvent.DEVICE_STATUS_CHANGED, payload);
    expect(got).toEqual([]);
    bus.flush(queue);
    expect(got).toEqual([payload]);
    bus.flush(queue); // flushing twice never re-emits
    expect(got).toHaveLength(1);
  });

  it('emits immediately for a non-transactional client', () => {
    const emitter = new EventEmitter2();
    const bus = new DomainEventBus(emitter);
    const got: unknown[] = [];
    emitter.on(DomainEvent.DEVICE_STATUS_CHANGED, (e) => got.push(e));
    bus.publish({}, DomainEvent.DEVICE_STATUS_CHANGED, payload);
    expect(got).toEqual([payload]);
  });

  it('a throwing subscriber does not break the publisher', () => {
    const emitter = new EventEmitter2();
    const bus = new DomainEventBus(emitter);
    emitter.on(DomainEvent.DEVICE_STATUS_CHANGED, () => {
      throw new Error('subscriber bug');
    });
    expect(() => bus.publish({}, DomainEvent.DEVICE_STATUS_CHANGED, payload)).not.toThrow();
  });
});
