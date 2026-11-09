// Round 48 tests: the Copilot golden household example, the
// lifestyle waterfall identity, the statement CSV parser, and the
// Assaf harness - his real fixture state stays accuracy X and the
// collapsed Home card face shows Not personalized / 3 inputs.
// Run: node engine-tests/round48.ts   (Node >= 22 type stripping)
import { readFileSync } from "node:fs";
import {
  ageOn,
  deflateToToday,
  householdRetirement,
  lifestyleBreakdown,
  projectToCommonDate,
  retirementAccuracy,
  type LifestyleData,
} from "../src/goals.ts";
import { payslip401kTotals, payslipForecast } from "../src/payslips.ts";
import { parseSpendingCsv } from "../src/spendingCsv.ts";

let pass = 0;
let fail = 0;
function eq(name: string, got: unknown, want: unknown) {
  if (got === want) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
}
function near(name: string, got: number, want: number, tol: number) {
  if (Math.abs(got - want) <= tol) { pass++; console.log(`ok   ${name} (${got})`); }
  else { fail++; console.log(`FAIL ${name}: got ${got}, want ${want} +/- ${tol}`); }
}

// --- 1. Golden household example (Copilot) -------------------------
{
  const hh = householdRetirement({
    spendingAnnual: 150000,
    socialSecurityAnnual: 40000, // dependable 70,000 in total
    pensionAnnual: 30000,
    otherAnnual: 0,
    projectedPortfolio: 0,
  });
  eq("golden dependable", hh.dependableAnnual, 70000);
  eq("golden gap/yr", hh.portfolioGapAnnual, 80000);
  eq("golden need 3.5%", hh.needConservative, 2285714);
  eq("golden need 4.0%", hh.needBase, 2000000);
  eq("golden need 4.5%", hh.needFlexible, 1777778);
}

// --- 2. Waterfall identity on the composed case --------------------
{
  const l: LifestyleData = {
    amounts: { housing: 36000, food: 18000, travel: 12000, healthcare: 8000, k401: 41400, payroll_taxes: 30000 },
    states: { food: "changes", travel: "ends" },
    adjusted: { food: 15000 },
    additionsAnnual: 6000,
    confirmed: false,
  };
  const bd = lifestyleBreakdown(l);
  eq("waterfall currentSpending", bd.currentSpending, 145400);
  eq("waterfall endingTotal", bd.endingTotal, 83400);
  eq("waterfall changesDelta", bd.changesDelta, -3000);
  eq("waterfall additions", bd.additions, 6000);
  eq("waterfall lifestyleAnnual", bd.lifestyleAnnual, 65000);
  eq("waterfall lifestyleToday", bd.lifestyleToday, 74000);
  eq("waterfall identity", bd.currentSpending - bd.endingTotal + bd.changesDelta + bd.additions, bd.lifestyleAnnual);

  const empty = lifestyleBreakdown({ amounts: {}, states: {}, adjusted: {}, additionsAnnual: 0, confirmed: false });
  eq("waterfall empty current", empty.currentSpending, 0);
  eq("waterfall empty lifestyle", empty.lifestyleAnnual, 0);
}

// --- 3. Statement CSV parser ---------------------------------------
{
  const bank = [
    "Date,Description,Amount",
    "10/05/2026,SAFEWAY GROCERY,-600.00",
    "10/06/2026,PAYROLL DEPOSIT,3000.00",
    "11/05/2026,SAFEWAY GROCERY,-600.00",
    "12/05/2026,SHELL FUEL,-100.00",
    "12/10/2026,COUNTY PROPERTY TAX,-1200.00",
  ].join("\n");
  const r = parseSpendingCsv(bank, "bank");
  eq("csv bank parsed", r !== null, true);
  if (r) {
    eq("csv bank months", r.months, 3);
    eq("csv bank transactions", r.transactions, 4);
    eq("csv bank total/yr", r.totalOutflowAnnual, 10000);
    eq("csv bank food/yr", r.byCategory["food"], 4800);
    eq("csv bank transport/yr", r.byCategory["transportation"], 400);
    eq("csv bank property tax/yr", r.byCategory["property_tax_hoa"], 4800);
  }

  const pair = [
    "Date,Description,Debit,Credit",
    "01/15/2026,RENT PAYMENT,2000.00,",
    "01/20/2026,STORE REFUND,,500.00",
    "02/15/2026,RENT PAYMENT,2000.00,",
  ].join("\n");
  const r2 = parseSpendingCsv(pair, "bank");
  eq("csv pair parsed", r2 !== null, true);
  if (r2) {
    eq("csv pair months", r2.months, 2);
    eq("csv pair transactions", r2.transactions, 2);
    eq("csv pair housing/yr", r2.byCategory["housing"], 24000);
  }

  const card = [
    "Date,Description,Amount",
    "03/01/2026,AMAZON MKTPLACE,50.00",
    "03/02/2026,PAYMENT THANK YOU,50.00",
    "03/03/2026,NETFLIX,20.00",
  ].join("\n");
  const r3 = parseSpendingCsv(card, "card");
  eq("csv card parsed", r3 !== null, true);
  if (r3) {
    eq("csv card months", r3.months, 1);
    eq("csv card total/yr", r3.totalOutflowAnnual, 840);
    eq("csv card other/yr", r3.byCategory["other"], 600);
    eq("csv card entertainment/yr", r3.byCategory["entertainment"], 240);
  }

  eq("csv garbage is null", parseSpendingCsv("hello\nworld", "bank"), null);
}

// --- 4. Assaf harness ----------------------------------------------
// His 5 fixture payslips, nothing personalized: the state must stay
// accuracy X, the card face must read Not ready to score / Not
// personalized yet / 3 inputs needed, and the details placeholder
// must equal the round-47 needBase of 8,539,150.
{
  const fixture = JSON.parse(readFileSync("/home/hatch/workspace/hometower/prepared-payslips.json", "utf-8"));
  const documents = fixture.records;
  const family = [
    { id: "a", name: "Assaf Harel", role: "self" },
    { id: "y", name: "Yamit Harel", role: "spouse" },
  ];
  const jobs = [
    { memberName: "Assaf Harel", payFrequency: "semimonthly" },
    { memberName: "Yamit Harel", payFrequency: "semimonthly" },
  ];
  const today = "2026-11-08";
  const slipFc = payslipForecast(documents, family, jobs, today);
  eq("harness forecast exists", slipFc !== null, true);
  if (slipFc) near("harness projectedGross", slipFc.projectedGross, 487951.03, 1);

  const incomeBasis = slipFc ? slipFc.projectedGross : 0;
  const lifestyleBd = lifestyleBreakdown({ amounts: {}, states: {}, adjusted: {}, additionsAnnual: 0, confirmed: false });
  const lifestyleConfirmed = false; // fixture goals: lifestyle untouched
  const spendingAnnual = lifestyleConfirmed && lifestyleBd.lifestyleAnnual > 0
    ? lifestyleBd.lifestyleAnnual
    : Math.round(incomeBasis * 0.7);
  eq("harness spending fallback", spendingAnnual, 341566);

  const k401 = payslip401kTotals(documents, today, jobs);
  const paceOf = (name: string) => k401?.perEarner.find((e) => e.name === name)?.monthlyPace ?? 0;
  const adultsModel = [
    { dob: "1977-09-26", retireAge: 60, mo: paceOf("Assaf Harel") },
    { dob: "1978-05-15", retireAge: 50, mo: paceOf("Yamit Harel") },
  ];
  const yearsOwn = adultsModel.map((a) => Math.max(0, a.retireAge - (ageOn(a.dob, today) ?? 0)));
  const laterYears = Math.max(...yearsOwn);
  const nominal = adultsModel.reduce((s, a, i) => s + projectToCommonDate(0, a.mo, yearsOwn[i], laterYears, 6), 0);
  const projectedToday = deflateToToday(nominal, laterYears, 2.5);
  console.log(`     harness projectedToday (today's $): ${Math.round(projectedToday)}; laterYears ${laterYears}`);

  const hhRet = householdRetirement({
    spendingAnnual,
    socialSecurityAnnual: 0,
    pensionAnnual: 0,
    otherAnnual: 0,
    projectedPortfolio: projectedToday,
  });
  eq("harness needBase (rough placeholder)", hhRet.needBase, 8539150);

  const accuracy = retirementAccuracy({
    spendingSet: false,
    ssEnteredAdults: 0,
    adultCount: 2,
    pensionKnown: false,
    hasBalances: false,
    hasPace: adultsModel.some((a) => a.mo > 0),
  });
  eq("harness accuracy level", accuracy.level, "X");
  eq("harness missing count", accuracy.missing.length, 3);

  // The collapsed card-face model the screen renders from these:
  const face = {
    headline: accuracy.level === "X" ? "Not ready to score" : "?",
    middleTile: accuracy.level === "X" ? "Not personalized yet" : "?",
    inputsNeeded: accuracy.missing.length,
    readinessShown: accuracy.level !== "X",
  };
  eq("face headline", face.headline, "Not ready to score");
  eq("face middle tile", face.middleTile, "Not personalized yet");
  eq("face inputs needed", face.inputsNeeded, 3);
  eq("face shows no readiness %", face.readinessShown, false);
}

console.log(`\nround48: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
