# React

javascript-excel has no React dependency. In a component you call it from an event handler: build the sheet, write it, download it. No hooks or context are needed for that.

For a React layer on top (ready-made export components and dataset helpers), see [react-data-export](https://github.com/securedeveloper/react-data-export), which uses javascript-excel underneath.

```sh
cd examples/react
npm run dev
```

<!-- example: examples/react/src/main.tsx -->
```tsx
// javascript-excel in React, without hooks: the export runs in an event handler.
// For a component library on top of this (<ExcelFile>-style export buttons and
// dataset helpers), see react-data-export.
import { createRoot } from "react-dom/client";
import { fromDataset, toBlob } from "javascript-excel";
import { download } from "javascript-excel/dom";

interface Order {
  id: number;
  customer: string;
  total: number;
}

const orders: Order[] = [
  { id: 1001, customer: "Ada", total: 1250.5 },
  { id: 1002, customer: "Grace", total: 980 },
];

async function exportOrders(rows: Order[]): Promise<void> {
  const sheet = fromDataset(
    {
      columns: [
        { title: "Order", key: "id" },
        { title: "Customer", key: "customer", width: "auto" },
        { title: "Total", key: "total", numFmt: "#,##0.00", total: "sum" },
      ],
      data: rows,
    },
    { name: "Orders", freezeHeader: true, totals: { label: "Total" } },
  );
  download(await toBlob({ sheets: [sheet] }), "orders.xlsx");
}

function OrdersTable({ rows }: { rows: Order[] }) {
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Order</th>
            <th>Customer</th>
            <th>Total</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => (
            <tr key={o.id}>
              <td>{o.id}</td>
              <td>{o.customer}</td>
              <td>{o.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <button onClick={() => void exportOrders(rows)}>Export to .xlsx</button>
    </>
  );
}

createRoot(document.getElementById("root")!).render(<OrdersTable rows={orders} />);
```

Notes:

- `fromDataset` turns `{ columns, data }` into a sheet. `key` reads a field, `path` reads a nested one (`"sales.q1"`), and a function reads anything. Columns can have `numFmt`, `width` (characters, `{ wpx }` or `"auto"`), `total` and child columns, which give merged group headers.
- To export a table that is already on the page, use `fromTable(tableRef)` from `javascript-excel/dom`, as in the [vanilla guide](vanilla.md).
- Importing `javascript-excel/dom` is safe during server-side rendering. Only calling `download` or `fromTable` needs a DOM.
