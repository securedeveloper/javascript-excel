---
"javascript-excel": patch
---

`toUint8Array` and `toBlob` now return to the event loop about every 16 ms while they write, so a large export on the main thread no longer freezes the page: frames render, timers and input run, and an abort from a timer or a click takes effect while the write is in flight. The output bytes are unchanged.
