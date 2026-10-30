import { route } from "../../../../api/http.ts";
import { groupExportCsv } from "../../../../services/export.ts";

export const GET = route(({ ctx, params }) => {
  const { filename, csv } = groupExportCsv(ctx, Number(params.groupId));
  return new Response(csv, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
});
