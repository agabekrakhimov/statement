# Power BI / Microsoft Fabric package

Everything from the 4 October settlements (BL-001023, -001024, -001050, -001051), already
cleaned into a star schema so you can build the report in a few minutes.

| File | What it is |
|---|---|
| `Fleet_Settlements_Oct2026.xlsx` | One sheet + Excel table per model table. **Import this into Power BI.** |
| `csv/*.csv` | Same tables as CSV (for a Fabric Lakehouse or Dataflow Gen2). |
| `Measures.dax` | All measures: RPM, CPM, MPG, deadhead %, operating profit, % of gross, red-flag colours. |
| `build_model.py` | Source of truth. Add next week's numbers here and re-run to refresh the xlsx, CSVs and `report/data.js`. |

## Tables

- **DimTruck** – TruckID, Driver, DriverRatePerMile
- **FactSettlement** – one row per statement: gross, driver pay, reimbursements, deductions, net pay
- **FactLoad** – one row per load: lanes, dates, loaded/empty/total miles, gross, driver pay, RPM, deadhead %
- **FactFuel** – one row per fuel/DEF purchase: gallons, retail, invoice, card discount, $/gal
- **FactDeduction** – every deduction line, bucketed into `Category`
  (Company Fee, Fixed Weekly, Fuel, Tolls, Maintenance, Driver Bonus, Registration,
  Safety / Driver Travel, Cash Advance) with `IsOperating` = FALSE for one-time items
- **FactReimbursement** – reimbursements credited back to you

`build_model.py` asserts that every statement foots (gross − driver pay + reimbursements −
deductions = net pay, fuel lines = fuel deduction) before writing anything.

## Build it in Power BI Desktop (≈10 minutes)

1. **Get data → Excel workbook** → pick `Fleet_Settlements_Oct2026.xlsx` → tick the 6 *tables* (not the sheets) → Load.
2. **Model view**: drag `DimTruck[TruckID]` onto `TruckID` in each Fact table, and
   `FactSettlement[SettlementID]` onto `SettlementID` in FactLoad / FactFuel / FactDeduction / FactReimbursement.
   Set `WeekStart` / `Date` columns to Date type.
3. **New table**: `Week = DISTINCT(FactSettlement[WeekStart])`, relate it to each Fact `WeekStart`.
4. **New measures**: paste the blocks from `Measures.dax`.
5. **Theme**: View → Themes → use a dark or light theme; set Truck 7777 = blue `#2a78d6`, Truck 777 = orange `#eb6834`
   everywhere so trucks keep the same colour on every page.

### Suggested pages

1. **Overview** – cards: Gross, Total Miles, RPM, CPM, Operating Profit, Net Pay, Deadhead %, MPG.
   Slicers: Week, Truck. Clustered bar: Gross by Week × Truck.
2. **Truck vs truck** – matrix with Truck on columns and the measures above as values;
   conditional formatting with the `Flag Colour …` measures.
3. **Where the money goes** – 100% stacked bar: Axis = Truck, Legend = FactDeduction[Category], Value = `Category % of Gross`
   (add Driver Pay as its own series).
4. **Fuel** – clustered column MPG by Truck × Week with a 6.5 constant line (Analytics pane);
   table of FactFuel with $/gal; map visual of fuel stops by City/State.
5. **Loads** – bar of load RPM sorted ascending with a constant line at CPM; bar of Deadhead % per load with a 15% line.
6. **Red flags** – table of FactDeduction filtered to `IsOperating = FALSE` plus a card for `Red Flag Count`.

## Microsoft Fabric

Upload the `csv/` folder to a Lakehouse (Files → Upload folder), right-click each file → **Load to tables**,
then **New semantic model** from the Lakehouse, add the same relationships and paste `Measures.dax`.
Build the report pages above on that model. For weekly refresh, replace the CSVs and the model picks them up.

## Adding next week

Add the new statement's loads / fuel / deductions / reimbursements to the dictionaries at the top of
`build_model.py`, then:

```
python3 powerbi/build_model.py
```

and click **Refresh** in Power BI.
