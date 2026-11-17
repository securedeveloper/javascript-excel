---
"javascript-excel": patch
---

`read` now returns to the event loop about every 16 ms while it parses, and feeds the decompressor in slices, so reading a large file on the main thread no longer freezes the page: frames render, timers and input run, and an abort from a timer or a click takes effect while the read is in flight. The resulting model is unchanged.
