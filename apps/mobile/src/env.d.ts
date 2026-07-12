declare module 'events' {
  interface EventEmitter {
    on(event: string, listener: (...args: unknown[]) => void): this
    off(event: string, listener: (...args: unknown[]) => void): this
    emit(event: string, ...args: unknown[]): boolean
    once(event: string, listener: (...args: unknown[]) => void): this
    removeAllListeners(event?: string): this
  }
  const EventEmitter: new () => EventEmitter
  export default EventEmitter
}
