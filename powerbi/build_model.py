"""Builds the Power BI / Fabric data model from the weekly owner settlements.

Run:  python3 powerbi/build_model.py
Outputs: powerbi/Fleet_Settlements_Oct2026.xlsx, powerbi/csv/*.csv, report/data.js
Every number below was typed from the PDFs (Wenze: BL-001023/-001024/-001050/-001051; VKL: BL-001611).
"""
import csv, json, os
from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

trucks = [
    {"TruckID": "7777", "Driver": "Robert Dockery", "DriverRatePerMile": 0.75},
    {"TruckID": "777", "Driver": "Damarion Charles Whitlock", "DriverRatePerMile": 0.70},
    {"TruckID": "555", "Driver": "Lionel R Jones", "DriverRatePerMile": 0.73},
]

settlements = [
    # SettlementID, truck, week start/end, check date, gross, driver pay, reimbursements, deductions, net
    dict(SettlementID="BL-001023", TruckID="7777", WeekStart="2026-10-12", WeekEnd="2026-10-18", CheckDate="2026-10-24",
         Trips=5, Gross=14350.00, DriverPay=3404.35, Reimbursements=0.00, Deductions=10937.57, NetPay=8.08),
    dict(SettlementID="BL-001024", TruckID="777", WeekStart="2026-10-12", WeekEnd="2026-10-18", CheckDate="2026-10-24",
         Trips=2, Gross=5460.00, DriverPay=1130.03, Reimbursements=2793.67, Deductions=5877.21, NetPay=1246.43),
    dict(SettlementID="BL-001050", TruckID="7777", WeekStart="2026-10-19", WeekEnd="2026-10-25", CheckDate="2026-10-30",
         Trips=3, Gross=6900.00, DriverPay=1963.74, Reimbursements=2643.04, Deductions=6092.90, NetPay=1486.40),
    dict(SettlementID="BL-001051", TruckID="777", WeekStart="2026-10-19", WeekEnd="2026-10-25", CheckDate="2026-10-30",
         Trips=4, Gross=6900.00, DriverPay=1400.56, Reimbursements=0.00, Deductions=4994.87, NetPay=504.57),
    dict(SettlementID="BL-001611", TruckID="555", WeekStart="2026-10-19", WeekEnd="2026-10-25", CheckDate="2026-10-28",
         Trips=3, Gross=13300.00, DriverPay=3709.61, Reimbursements=0.00, Deductions=6501.26, NetPay=3089.13,
         Carrier="VKL Trucking Inc", Owner="ODO Express LLC"),
    dict(SettlementID="BL-001669", TruckID="555", WeekStart="2026-11-02", WeekEnd="2026-11-08", CheckDate="2026-11-11",
         Trips=3, Gross=5500.00, DriverPay=1700.93, Reimbursements=564.29, Deductions=4022.91, NetPay=340.45,
         Carrier="VKL Trucking Inc", Owner="ODO Express LLC"),
]
for _s in settlements:
    _s.setdefault("Carrier", "Wenze Transport Services")
    _s.setdefault("Owner", "Og'abek Rakhimov")

# Load, PU, DEL, PU date, DEL date, loaded, empty, total, gross, driver pay
_loads = {
    "BL-001023": [
        ("6479540", "Augusta, KY", "Lewistown, PA", "2026-10-12", "2026-10-13", 500.00, 44.00, 544.00, 2000.00, 408.00),
        ("31440-10624", "Lime Ridge, PA", "Rincon, GA", "2026-10-13", "2026-10-14", 807.00, 69.00, 876.00, 2850.00, 657.00),
        ("S4400902", "Cheraw, SC", "Concordville, PA", "2026-10-14", "2026-10-15", 498.02, 220.00, 718.02, 1900.00, 538.52),
        ("442597", "Pittston, PA", "Olive Branch, MS", "2026-10-15", "2026-10-16", 1040.05, 124.11, 1164.16, 3500.00, 873.12),
        ("632222", "Jonesboro, AR", "Williamsburg, NY", "2026-10-17", "2026-10-19", 1139.13, 97.82, 1236.95, 4100.00, 927.71),
    ],
    "BL-001024": [
        ("80A9397", "Byhalia, MS", "St. Louis, MO", "2026-10-13", "2026-10-14", 323.93, 373.96, 697.89, 1660.00, 453.63),
        ("2147508", "Hazelwood, MO", "DeBary, FL", "2026-10-14", "2026-10-16", 1027.60, 13.01, 1040.61, 3800.00, 676.40),
    ],
    "BL-001050": [
        ("26-180055", "North Brunswick Twp, NJ", "Seffner, FL", "2026-10-19", "2026-10-21", 1102.40, 44.70, 1147.10, 3700.00, 860.33),
        ("6355", "Clearwater, FL", "Unadilla, GA", "2026-10-21", "2026-10-22", 361.70, 26.80, 388.50, 550.00, 291.38),
        ("132183024", "Fitzgerald, GA", "Gardner, KS", "2026-10-23", "2026-10-25", 1022.70, 60.00, 1082.70, 2650.00, 812.03),
    ],
    "BL-001051": [
        ("23421342", "Zephyrhills, FL", "Mableton, GA", "2026-10-20", "2026-10-21", 449.80, 87.00, 536.80, 900.00, 375.76),
        ("7000448271", "Kathleen, GA", "Hazleton, PA", "2026-10-21", "2026-10-23", 862.20, 170.00, 1032.20, 2600.00, 722.54),
        ("5498741", "Tunkhannock, PA", "Monroe, NJ", "2026-10-23", "2026-10-23", 176.60, 65.20, 241.80, 1500.00, 169.26),
        ("448536", "Chantilly, VA", "Hebron, KY", "2026-10-25", "2026-10-26", 165.00, 25.00, 190.00, 1900.00, 133.00),
    ],
    "BL-001611": [  # statement prints no pickup dates
        ("5035389", "Danville, KY", "Woodbridge Township, NJ", None, "2026-10-16", 0.00, 0.00, 0.00, 300.00, 0.00),
        ("9821846", "Luckey, OH", "Cheney, WA", None, "2026-10-22", 2046.82, 150.00, 2196.82, 7000.00, 1603.68),
        ("2627175", "Spokane, WA", "Wilmington, OH", None, "2026-10-26", 2110.67, 1.16, 2111.83, 6000.00, 1541.64),
    ],
    "BL-001669": [
        ("606843", "Hialeah, FL", "Green Brook Township, NJ", None, "2026-11-02", 1381.45, 3.38, 1384.83, 1000.00, 1010.93),
        ("176376", "East Rutherford, NJ", "Tucker, GA", None, "2026-11-05", 864.88, 33.32, 898.20, 2700.00, 655.69),
        ("60116488267", "Hialeah, FL", "South Brunswick Township, NJ", None, "2026-11-05", 7.00, 40.00, 47.00, 1800.00, 34.31),
    ],
}

# date, product, city, state, gallons, retail, invoice
_fuel = {
    "BL-001023": [
        ("2026-10-13", "DEF", "Ruther Glen", "VA", 12.05, 58.91, 58.91),
        ("2026-10-13", "Diesel", "Jeffersonville", "OH", 128.06, 749.03, 713.27),
        ("2026-10-13", "Diesel", "Ruther Glen", "VA", 42.00, 272.54, 246.13),
        ("2026-10-14", "Diesel", "Dunn", "NC", 103.00, 602.47, 542.01),
        ("2026-10-15", "Diesel", "Bordentown", "NJ", 141.00, 929.06, 861.27),
        ("2026-10-16", "Diesel", "Meadowview", "VA", 91.01, 590.57, 546.36),
        ("2026-10-16", "DEF", "Meadowview", "VA", 12.17, 59.48, 59.48),
        ("2026-10-17", "Diesel", "West Memphis", "AR", 84.02, 519.98, 470.77),
    ],
    "BL-001024": [
        ("2026-10-13", "Diesel", "Saint Louis", "MO", 122.38, 769.64, 676.62),
        ("2026-10-13", "DEF", "Saint Louis", "MO", 12.54, 60.06, 60.06),
        ("2026-10-15", "Diesel", "Macon", "GA", 120.00, 665.88, 651.77),
    ],
    "BL-001050": [
        ("2026-10-19", "Diesel", "Jeffersonville", "OH", 105.01, 645.71, 589.73),
        ("2026-10-20", "Diesel", "Bordentown", "NJ", 117.03, 768.80, 710.48),
        ("2026-10-20", "DEF", "Bordentown", "NJ", 12.21, 62.14, 62.14),
        ("2026-10-21", "Diesel", "Richmond Hill", "GA", 104.02, 581.35, 571.60),
        ("2026-10-22", "Diesel", "Bushnell", "FL", 74.07, 443.61, 426.71),
        ("2026-10-24", "Diesel", "Macon", "GA", 108.00, 601.47, 577.75),
        ("2026-10-25", "Diesel", "Calvert City", "KY", 83.04, 523.06, 493.79),
        ("2026-10-25", "DEF", "Calvert City", "KY", 12.02, 58.75, 58.75),
    ],
    "BL-001051": [
        ("2026-10-21", "Diesel", "Lake City", "FL", 119.16, 713.64, 692.98),
        ("2026-10-22", "DEF", "Lexington", "SC", 0.02, 0.08, 0.08),
        ("2026-10-22", "Diesel", "Lexington", "SC", 61.96, 361.80, 345.35),
        ("2026-10-23", "Diesel", "Staunton", "VA", 115.32, 755.20, 665.58),
        ("2026-10-25", "DEF", "Hagerstown", "MD", 18.01, 91.64, 91.64),
        ("2026-10-25", "Diesel", "Hagerstown", "MD", 154.58, 1049.46, 940.96),
    ],
    "BL-001611": [  # VKL prints retail only, no dates
        (None, "DEF", "Post Falls", "ID", 14.74, 61.75, 61.75),
        (None, "Diesel", "Post Falls", "ID", 176.26, 1207.21, 1207.21),
        (None, "Diesel", "Laurel", "MT", 112.40, 684.40, 684.40),
        (None, "Diesel", "Aurora", "NE", 127.09, 837.38, 837.38),
    ],
    "BL-001669": [],  # statement prints no fuel transactions
}

# Category (Power BI-friendly bucket), statement type, description, amount, recurring?
_ded = {
    "BL-001023": [
        ("Company Fee", "Company Fee", "Company fee 12%", 1722.00),
        ("Cash Advance", "Cash Advance", "EFS (company) 165989559", 106.00),
        ("Fixed Weekly", "Trailer Rental", "Trailer rental", 200.00),
        ("Fixed Weekly", "Eld Logbook", "Weekly ELD", 50.00),
        ("Fixed Weekly", "Ifta", "Weekly IFTA", 40.00),
        ("Fixed Weekly", "Insurance", "Weekly cargo + liability", 400.00),
        ("Tolls", "Tolls", "PrePass", 10.00),
        ("Safety / Driver Travel", "Safety", "Uber for Donomy Jenkins 09/17/2026", 187.35),
        ("Registration", "Safety", "Registration for 777 truck from 08/06/2026", 4507.13),
        ("Tolls", "Toll", "Toll transactions", 216.89),
        ("Fuel", "Fuel", "Fuel card (invoice price)", 3498.20),
    ],
    "BL-001024": [
        ("Company Fee", "Company Fee", "Company fee 12%", 655.20),
        ("Fixed Weekly", "Trailer Rental", "Trailer rental", 200.00),
        ("Fixed Weekly", "Eld Logbook", "Weekly ELD", 50.00),
        ("Fixed Weekly", "Ifta", "Weekly IFTA", 40.00),
        ("Fixed Weekly", "Insurance", "Weekly cargo + liability", 400.00),
        ("Tolls", "Tolls", "PrePass", 10.00),
        ("Safety / Driver Travel", "Safety", "Air ticket for Donomy Jenkins 09/16/2026", 363.48),
        ("Safety / Driver Travel", "Safety", "Air ticket for Moise Yankee 08/19/2026", 226.20),
        ("Safety / Driver Travel", "Safety", "Hotel for Damarion 09/17/2026", 75.09),
        ("Registration", "Safety", "Registration for truck 77777 08/20/2026", 2403.19),
        ("Safety / Driver Travel", "Safety", "Uber 09/18/2026", 18.95),
        ("Safety / Driver Travel", "Safety", "Uber 09/17/2026", 46.65),
        ("Fuel", "Fuel", "Fuel card (invoice price)", 1388.45),
    ],
    "BL-001050": [
        ("Company Fee", "Company Fee", "Company fee 12%", 828.00),
        ("Fixed Weekly", "Trailer Rental", "Trailer rental", 200.00),
        ("Fixed Weekly", "Eld Logbook", "Weekly ELD", 50.00),
        ("Fixed Weekly", "Ifta", "Weekly IFTA", 40.00),
        ("Fixed Weekly", "Insurance", "Weekly cargo + liability", 400.00),
        ("Tolls", "Tolls", "PrePass", 10.00),
        ("Maintenance", "Maintenance", "#7777 oil change, inv 4011180862 (10/21/2026)", 524.79),
        ("Tolls", "Toll", "Toll transactions", 549.16),
        ("Fuel", "Fuel", "Fuel card (invoice price)", 3490.95),
    ],
    "BL-001051": [
        ("Driver Bonus", "Bonus", "Bonus for driver, load 5498741", 100.00),
        ("Company Fee", "Company Fee", "Company fee 12%", 828.00),
        ("Fixed Weekly", "Trailer Rental", "Trailer rental", 200.00),
        ("Fixed Weekly", "Eld Logbook", "Weekly ELD", 50.00),
        ("Fixed Weekly", "Ifta", "Weekly IFTA", 40.00),
        ("Fixed Weekly", "Insurance", "Weekly cargo + liability", 400.00),
        ("Tolls", "Tolls", "PrePass", 10.00),
        ("Tolls", "Toll", "Toll transactions", 59.15),
        ("Maintenance", "Maintenance", "#777 oil change, inv 0026140 (10/16/2026)", 571.13),
        ("Fuel", "Fuel", "Fuel card (invoice price)", 2736.59),
    ],
    "BL-001611": [
        ("Maintenance", "Other", "Driver expense for diesel engine oil", 56.78),
        ("Fixed Weekly", "Admin Fee", "Weekly admin fee", 100.00),
        ("Fixed Weekly", "Insurance", "Weekly insurance", 400.00),
        ("Company Fee", "Company Fee", "Company fee 11% of gross", 1463.00),
        ("Fuel", "Fuel", "Fuel card (retail price)", 2790.74),
        ("Tolls", "Toll", "Toll transactions", 108.25),
        ("Fixed Weekly", "Other", "Recurrent #4: plate fee", 200.00),
        ("Salary Adjustment", "Salary Adjustments", "Salary adjustments auto charge (unexplained)", 1382.49),
    ],
    "BL-001669": [
        ("Safety / Driver Travel", "Other", "Hotel", 92.82),
        ("Safety / Driver Travel", "Other", "Uber", 15.95),
        ("Fixed Weekly", "Admin Fee", "Weekly admin fee", 100.00),
        ("Fixed Weekly", "Insurance", "Weekly insurance", 400.00),
        ("Company Fee", "Company Fee", "Company fee 11% of gross", 605.00),
        ("Fuel", "Fuel", "Fuel card (no transaction detail printed)", 2320.65),
        ("Tolls", "Toll", "Toll transactions", 288.49),
        ("Fixed Weekly", "Other", "Recurrent #1: plate fee", 200.00),
    ],
}

_reimb = {
    "BL-001024": [("Rodrick approve", 1500.00), ("Net pay for 7777, 10/05-10/11", 133.06), ("Net pay for 777, 10/05-10/11", 1160.61)],
    "BL-001050": [("For registration", 2643.04)],
    "BL-001669": [("Driver salary difference from week Oct 19-25", 564.29)],
}

# --- flatten -------------------------------------------------------------
s_by_id = {s["SettlementID"]: s for s in settlements}
loads, fuel, deds, reimbs = [], [], [], []
for sid, rows in _loads.items():
    s = s_by_id[sid]
    for r in rows:
        loads.append(dict(LoadID=r[0], SettlementID=sid, TruckID=s["TruckID"], WeekStart=s["WeekStart"], Pickup=r[1], Delivery=r[2],
                          PickupDate=r[3], DeliveryDate=r[4], LoadedMiles=r[5], EmptyMiles=r[6], TotalMiles=r[7], Gross=r[8], DriverPay=r[9],
                          RPM=round(r[8] / r[7], 3) if r[7] else None, LoadedRPM=round(r[8] / r[5], 3) if r[5] else None,
                          DeadheadPct=round(r[6] / r[7], 4) if r[7] else None))
for sid, rows in _fuel.items():
    s = s_by_id[sid]
    for i, r in enumerate(rows, 1):
        fuel.append(dict(FuelID=f"{sid}-F{i}", SettlementID=sid, TruckID=s["TruckID"], WeekStart=s["WeekStart"], Date=r[0], Product=r[1],
                         City=r[2], State=r[3], Gallons=r[4], RetailAmount=r[5], InvoiceAmount=r[6], Discount=round(r[5] - r[6], 2),
                         PricePerGal=round(r[6] / r[4], 3) if r[4] >= 1 else None))
for sid, rows in _ded.items():
    s = s_by_id[sid]
    for i, r in enumerate(rows, 1):
        deds.append(dict(DeductionID=f"{sid}-D{i}", SettlementID=sid, TruckID=s["TruckID"], WeekStart=s["WeekStart"], Category=r[0],
                         StatementType=r[1], Description=r[2], Amount=r[3],
                         IsOperating=r[0] not in ("Registration", "Safety / Driver Travel", "Cash Advance", "Salary Adjustment", "Other")))
for sid, rows in _reimb.items():
    s = s_by_id[sid]
    for i, r in enumerate(rows, 1):
        reimbs.append(dict(ReimbursementID=f"{sid}-R{i}", SettlementID=sid, TruckID=s["TruckID"], WeekStart=s["WeekStart"], Description=r[0], Amount=r[1]))

# --- integrity checks: every statement must foot -------------------------
for s in settlements:
    sid = s["SettlementID"]
    L = [l for l in loads if l["SettlementID"] == sid]
    assert round(sum(l["Gross"] for l in L), 2) == s["Gross"], sid
    if round(sum(l["DriverPay"] for l in L), 2) != s["DriverPay"]:
        print(f"NOTE {sid}: driver pay charged {s['DriverPay']} != load payments {round(sum(l['DriverPay'] for l in L), 2)}")
    assert round(sum(d["Amount"] for d in deds if d["SettlementID"] == sid), 2) == s["Deductions"], sid
    assert round(sum(r["Amount"] for r in reimbs if r["SettlementID"] == sid), 2) == s["Reimbursements"], sid
    assert round(s["Gross"] - s["DriverPay"] + s["Reimbursements"] - s["Deductions"], 2) == s["NetPay"], sid
    fuel_inv = round(sum(f["InvoiceAmount"] for f in fuel if f["SettlementID"] == sid), 2)
    if fuel_inv: assert fuel_inv == next(d["Amount"] for d in deds if d["SettlementID"] == sid and d["Category"] == "Fuel"), sid

# --- per-truck / per-week metrics (for the HTML report) -----------------
def metrics(filter_fn):
    L = [l for l in loads if filter_fn(l)]
    F = [f for f in fuel if filter_fn(f)]
    D = [d for d in deds if filter_fn(d)]
    R = [r for r in reimbs if filter_fn(r)]
    S = [s for s in settlements if filter_fn(s)]
    miles = sum(l["TotalMiles"] for l in L)
    loaded = sum(l["LoadedMiles"] for l in L)
    empty = sum(l["EmptyMiles"] for l in L)
    gross = sum(l["Gross"] for l in L)
    dpay = sum(s["DriverPay"] for s in S)
    cat = {}
    for d in D:
        cat[d["Category"]] = round(cat.get(d["Category"], 0) + d["Amount"], 2)
    diesel_gal = sum(f["Gallons"] for f in F if f["Product"] == "Diesel")
    diesel_cost = sum(f["InvoiceAmount"] for f in F if f["Product"] == "Diesel")
    def_cost = sum(f["InvoiceAmount"] for f in F if f["Product"] == "DEF")
    op_cost = dpay + sum(d["Amount"] for d in D if d["IsOperating"])
    one_time = sum(d["Amount"] for d in D if not d["IsOperating"])
    reimb = sum(r["Amount"] for r in R)
    net = sum(s["NetPay"] for s in S)
    return dict(
        loads=len(L), miles=round(miles, 2), loaded=round(loaded, 2), empty=round(empty, 2), gross=round(gross, 2),
        driverPay=round(dpay, 2), categories=cat, dieselGal=round(diesel_gal, 2), dieselCost=round(diesel_cost, 2),
        defCost=round(def_cost, 2), fuelDiscount=round(sum(f["Discount"] for f in F), 2),
        rpm=gross / miles, loadedRpm=gross / loaded, deadheadPct=empty / miles, mpg=miles / diesel_gal if diesel_gal else None,
        pricePerGal=diesel_cost / diesel_gal if diesel_gal else None, fuelPerMile=(diesel_cost + def_cost) / miles,
        operatingCost=round(op_cost, 2), cpm=op_cost / miles, operatingProfit=round(gross - op_cost, 2),
        operatingMargin=(gross - op_cost) / gross, oneTimeCharges=round(one_time, 2), reimbursements=round(reimb, 2),
        netPay=round(net, 2),
    )

weeks = sorted({s["WeekStart"] for s in settlements})
out = {
    "trucks": trucks,
    "settlements": settlements,
    "loads": loads, "fuel": fuel, "deductions": deds, "reimbursements": reimbs,
    "fleet": metrics(lambda r: True),
    "byTruck": {t["TruckID"]: metrics(lambda r, t=t: r["TruckID"] == t["TruckID"]) for t in trucks},
    "byTruckWeek": {f'{t["TruckID"]}|{w}': metrics(lambda r, t=t, w=w: r["TruckID"] == t["TruckID"] and r["WeekStart"] == w)
                    for t in trucks for w in weeks
                    if any(s["TruckID"] == t["TruckID"] and s["WeekStart"] == w for s in settlements)},
}
with open(os.path.join(ROOT, "report", "data.js"), "w") as fh:
    fh.write("// Generated by powerbi/build_model.py - do not edit by hand.\nwindow.FLEET = " + json.dumps(out) + ";\n")

# --- CSVs + Excel for Power BI / Fabric -----------------------------------
tables = {"DimTruck": trucks, "FactSettlement": settlements, "FactLoad": loads, "FactFuel": fuel,
          "FactDeduction": deds, "FactReimbursement": reimbs}
os.makedirs(os.path.join(HERE, "csv"), exist_ok=True)
wb = Workbook()
wb.remove(wb.active)
for name, rows in tables.items():
    cols = list(rows[0].keys())
    with open(os.path.join(HERE, "csv", f"{name}.csv"), "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols)
        w.writeheader()
        w.writerows(rows)
    ws = wb.create_sheet(name)
    ws.append(cols)
    for r in rows:
        ws.append([r[c] for c in cols])
    for c in ws[1]:
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor="1F3A5F")
    for i, col in enumerate(cols, 1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = max(12, min(45, len(col) + 4,
                                                                       max(len(str(r[col])) for r in rows) + 2))
    ref = f"A1:{ws.cell(1, len(cols)).column_letter}{len(rows) + 1}"
    t = Table(displayName=name, ref=ref)
    t.tableStyleInfo = TableStyleInfo(name="TableStyleMedium2", showRowStripes=True)
    ws.add_table(t)
    ws.freeze_panes = "A2"
wb.save(os.path.join(HERE, "Fleet_Settlements_Oct2026.xlsx"))
print(json.dumps({k: {kk: (round(vv, 3) if isinstance(vv, float) else vv) for kk, vv in v.items()} for k, v in out["byTruck"].items()}, indent=1))
print(json.dumps({k: {kk: round(v[kk], 3) for kk in ("mpg", "rpm", "cpm", "deadheadPct", "operatingProfit", "miles", "dieselGal")} for k, v in out["byTruckWeek"].items()}, indent=1))
