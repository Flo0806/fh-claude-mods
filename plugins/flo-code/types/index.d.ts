declare module 'claude-code' {
  interface PluginState {
    // clock: the current local time as "HH:MM", date: the weekday and day shown beside it.
    'flo-code': { clock: string; date: string }
  }
}
