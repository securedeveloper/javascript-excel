# Vue 3

The same library calls from a Vue component: export a dataset, and open a file to see its sheets. This example uses the Composition API with a render function, so it needs no single-file-component compiler. In a `.vue` file the `setup` code is the same.

```sh
cd examples/vue
npm run dev
```

<!-- example: examples/vue/src/main.ts -->
```ts
// javascript-excel in Vue 3 (Composition API, render function, no SFC compiler needed).
import { createApp, defineComponent, h, ref } from "vue";
import { fromDataset, toBlob } from "javascript-excel";
import { download } from "javascript-excel/dom";
import { read } from "javascript-excel/read";

const Orders = defineComponent({
  setup() {
    const orders = ref([
      { id: 1001, customer: "Ada", total: 1250.5 },
      { id: 1002, customer: "Grace", total: 980 },
    ]);
    const opened = ref("");

    async function exportOrders(): Promise<void> {
      const sheet = fromDataset(
        {
          columns: [
            { title: "Order", key: "id" },
            { title: "Customer", key: "customer", width: "auto" },
            { title: "Total", key: "total", numFmt: "#,##0.00", total: "sum" },
          ],
          data: orders.value,
        },
        { name: "Orders", freezeHeader: true, totals: { label: "Total" } },
      );
      download(await toBlob({ sheets: [sheet] }), "orders.xlsx");
    }

    async function openFile(event: Event): Promise<void> {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;
      const { workbook } = await read(file);
      opened.value = workbook.sheets.map((s) => `${s.name}: ${s.dimension ?? "empty"}`).join(", ");
    }

    return () =>
      h("div", [
        h("ul", orders.value.map((o) => h("li", { key: o.id }, `${o.id} ${o.customer} ${o.total.toFixed(2)}`))),
        h("button", { onClick: exportOrders }, "Export to .xlsx"),
        h("input", { type: "file", accept: ".xlsx,.xlsm", onChange: openFile }),
        h("p", opened.value),
      ]);
  },
});

createApp(Orders).mount("#app");
```

Notes:

- `read` accepts the `File` from an `<input type="file">` directly, because a `File` is a `Blob`. It also accepts a `Uint8Array` or an `ArrayBuffer`.
- `read` returns `{ workbook, warnings }`. Damaged content the reader can recover from (a missing style part, an unsupported chart) becomes a warning rather than an error.
- For big files, run `read` in a worker (`javascript-excel/worker`), as in the [vanilla guide](vanilla.md).
