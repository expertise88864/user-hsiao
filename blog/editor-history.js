// Article-only, in-memory history. Opening/reloading starts a new session;
// authenticated Git base versions and durable drafts are managed separately.
export function createHistory(initial, maxEntries = 64, maxBytes = 8 * 1024 * 1024) {
  var entries = [initial], position = 0, group = '', lastTime = 0;
  function breakGroup() { group = ''; }
  return {
    get canUndo() { return position > 0; },
    get canRedo() { return position + 1 < entries.length; },
    selection(value) { entries[position].selection = value; },
    record(state, key = '', now = performance.now()) {
      if (state.html === entries[position].html) return false;
      var merge = key && key === group && now - lastTime <= 1000 && position > 0 && position === entries.length - 1;
      entries.splice(position + 1);
      if (merge) entries[position] = state;
      else { entries.push(state); position++; }
      group = key; lastTime = now;
      var bytes = entries.reduce(function (sum, entry) { return sum + entry.html.length * 2; }, 0);
      // Always retain the immediately previous state, including large articles.
      while (entries.length > 2 && (entries.length > maxEntries || bytes > maxBytes)) {
        bytes -= entries.shift().html.length * 2; position--;
      }
      return true;
    },
    undo() { breakGroup(); return position > 0 ? entries[--position] : null; },
    redo() { breakGroup(); return position + 1 < entries.length ? entries[++position] : null; },
    breakGroup
  };
}
