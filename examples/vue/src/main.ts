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
