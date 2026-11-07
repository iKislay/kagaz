import { Global, Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { DomainEventBus } from './domain-events.js';

/** Global post-commit domain event bus (see DomainEvent for event names). */
@Global()
@Module({
  imports: [EventEmitterModule.forRoot({ wildcard: false })],
  providers: [DomainEventBus],
  exports: [DomainEventBus],
})
export class EventsModule {}
