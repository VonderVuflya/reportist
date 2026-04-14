import ExcelJS from 'exceljs';

export async function renderXlsx(
  build: (wb: ExcelJS.Workbook) => void | Promise<void>,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Reportist';
  wb.created = new Date();
  await build(wb);
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
