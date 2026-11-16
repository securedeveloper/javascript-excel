---
"javascript-excel": patch
---

The writer's content-keyed style cache now applies only to styles made of plain objects. A style containing an object with `toJSON` (or another non-plain object) could share a cache key with a valid style and skip validation: an invalid colour `{ toJSON: () => "FF0000" }` was written as red instead of throwing `INVALID_STYLE`. Such styles are now resolved as they are.
