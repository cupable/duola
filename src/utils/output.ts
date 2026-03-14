export function printOutput<T>(value: T, format: "json" | "table" = "table"): void {
  if (format === "json") {
    console.log(JSON.stringify(value, null, 2));
    return;
  }

  if (Array.isArray(value)) {
    console.table(value);
    return;
  }

  console.dir(value, { depth: null });
}
