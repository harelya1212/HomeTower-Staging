// Household state: the living record (owner requirement, 2026-11-07).
// Everything the user defines - intake, goals, documents, snapshot
// inputs - is editable at any time and persisted on-device only
// (local-first). Every edit recomputes the snapshot and accuracy level.
import AsyncStorage from "@react-native-async-storage/async-storage";
import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { DocumentRecord, HouseholdIntake, Member } from "../engine/intake.ts";

export interface GoalInputs {
  retirementBalance: number;
  retirementMonthly: number;
  retirementYears: number;
  retirementTarget: number;
  eduBalance: number;
  eduMonthly: number;
  eduYears: number;
  eduTarget: number;
  assumedReturnPct: number; // labelled assumption, editable - never hidden
  // Household retirement income (round 46): the need is a household
  // figure - spending minus dependable income, over a withdrawal rate.
  pensionAnnual: number; // expected pension $/yr, 0 = unset (a pension statement's monthly benefit feeds it when unset)
  otherRetirementIncomeAnnual: number; // other dependable $/yr (net rent, annuities), 0 = unset
  retirementSpendingAnnual: number; // target retirement spending $/yr, 0 = unset (default: 70% of projected income, a starting assumption)
  // Round 47: how the spending target is set, the budget worksheet
  // behind "build a budget", the inflation assumption behind
  // today's-dollars figures, and the no-pension declaration that
  // lets a household with no pension reach the top accuracy level.
  spendingMode: "estimate" | "custom" | "budget";
  retirementBudget: { housing: number; food: number; healthcare: number; travel: number; other: number };
  inflationPct: number; // labelled assumption, default 2.5
  noPension: boolean; // household declares it has no pension (pension then counts as known)
  stateRefundTargetLow: number;
  stateRefundTargetHigh: number;
}

// The My House tables (owner QA round 2). The family basics also sync
// into intake.members (the engine model); jobs and assets feed the
// dashboard derivations (retirement years from ages, balances from the
// assets table) so there is ONE place where the household is described.
export interface UiMember {
  id: string;
  name: string;
  role: "self" | "spouse" | "child" | "other";
  dob: string; // YYYY-MM-DD or ""
  retireAge: number; // adults: planned retirement age
  retireTarget: number; // adults: personal retirement target $, 0 = unset (owner QA round 8: per person, not one household figure)
  ssAnnual: number; // adults: expected Social Security $/yr in retirement, 0 = unset (round 46: feeds the household retirement need)
  ssClaimAge: number; // adults: planned Social Security claiming age (round 47; 67 = full retirement age)
  retireFlex: "fixed" | "plus1" | "plus3" | "flexible"; // adults: retirement-age flexibility (round 47 - powers the "work a little longer" sensitivity line)
  pensionAnnual: number; // adults: this person's own pension $/yr, 0 = unset (round 47: pension is per adult; a statement feeds the household when no one has entered one)
  eduTarget: number; // children: education target for THIS child $, 0 = unset (owner QA round 8: per child)
  studentNow: boolean; // children: currently in college
  collegeStartYear: number; // children: 0 = unknown
  yearsLeftInCollege: number; // children who are students now
  // Per-child education funding (owner QA round 18, SPEC45 sec. 32)
  eduBalance: number; // this child's saved balance
  eduMonthly: number; // this child's monthly contribution
  eduAnnualCost: number; // expected cost per college year, 0 = unset
  eduInState: boolean; // true = in-state costs, false = out-of-state
  eduRoomBoard: boolean; // true = cost includes room & board
  eduScholarshipYear: number; // expected scholarship per year
  eduDurationYears: number; // years of college to fund, default 4
}

export interface Job {
  id: string;
  memberName: string;
  employer: string;
  startDate: string; // YYYY-MM-DD or ""
  endDate: string; // "" = current job
  payFrequency: "weekly" | "biweekly" | "semimonthly" | "monthly";
}

export type AssetKind = "home" | "brokerage" | "401k" | "ira" | "hsa" | "529" | "bank" | "rental" | "other";

export interface Asset {
  id: string;
  kind: AssetKind;
  label: string;
  ownerName: string; // for a 529: the child it belongs to
  value: number;
  monthly: number;
}

export interface PayrollCheck {
  lastConfirmedOn: string | null; // last provisional no-change confirmation
  consecutive: number; // provisional cycles in a row (verification due at 2)
}

/** SPEC45 sec. 19 quarterly equity events - the Ongoing center's
 * Bonuses & RSU/ESPP card keeps their timeline. */
export interface EquityEvent {
  id: string;
  kind: "bonus" | "rsu_vest" | "espp_purchase";
  date: string; // YYYY-MM-DD
  amount: number;
  note: string;
}

export interface HouseholdState {
  intake: HouseholdIntake;
  grossIncome: number;
  federalWithholdingYtd: number;
  stateWithholdingYtd: number;
  ltcgIncome: number;
  pushEnabled: boolean; // default ON (owner requirement)
  goals: GoalInputs;
  onboarded: boolean;
  family: UiMember[];
  jobs: Job[];
  assets: Asset[];
  payrollCheck: PayrollCheck;
  eduAssignChildId: string | null; // transient: My House child card -> Documents 529 assignment
  events: EquityEvent[];
  // Daily market-close push (owner, 2026-11-07): OFF until the user
  // explicitly consents - only then may the holdings snapshot
  // (tickers, quantities, cash total) leave the device, to the
  // HomeTower sender, under the device secret. See MARKET_PUSH.md.
  marketPush: { consent: boolean; deviceSecret: string | null; syncedOn: string | null };
}

const STORAGE_KEY = "hometower.state.v1";

export function defaultState(): HouseholdState {
  return {
    intake: {
      name: "",
      state: "AZ",
      filingStatus: "married_filing_jointly",
      members: [{ name: "", role: "adult", payFrequency: "biweekly" } as Member],
      refundTargetLow: 2000,
      refundTargetHigh: 3000,
      documents: [] as DocumentRecord[],
      hasRsu: false,
      hasEspp: false,
      hasForeignAccountsOrIncome: false,
      ytdPayrollKnown: false,
      capitalLossCarryforwardKnown: false,
    },
    grossIncome: 0,
    federalWithholdingYtd: 0,
    stateWithholdingYtd: 0,
    ltcgIncome: 0,
    pushEnabled: true,
    family: [],
    jobs: [],
    assets: [],
    goals: {
      retirementBalance: 0,
      retirementMonthly: 0,
      retirementYears: 10,
      retirementTarget: 0,
      eduBalance: 0,
      eduMonthly: 0,
      eduYears: 5,
      eduTarget: 0,
      assumedReturnPct: 6,
      stateRefundTargetLow: 1000,
      stateRefundTargetHigh: 3000,
      pensionAnnual: 0,
      otherRetirementIncomeAnnual: 0,
      retirementSpendingAnnual: 0,
      spendingMode: "estimate",
      retirementBudget: { housing: 0, food: 0, healthcare: 0, travel: 0, other: 0 },
      inflationPct: 2.5,
      noPension: false,
    },
    onboarded: false,
    payrollCheck: { lastConfirmedOn: null, consecutive: 0 },
    marketPush: { consent: false, deviceSecret: null, syncedOn: null },
    eduAssignChildId: null,
    events: [],
  };
}

/** SPEC45 sec. 16 profile signals, derived from the My House tables. */
export function buildProfileExtras(state: HouseholdState) {
  return {
    hasHsa: state.assets.some((a) => a.kind === "hsa"),
    hasBrokerage: state.assets.some((a) => a.kind === "brokerage"),
    hasRental: state.assets.some((a) => a.kind === "rental"),
    hasCollegeStudent:
      state.family.some((m) => m.role === "child" && m.studentNow) || state.assets.some((a) => a.kind === "529"),
  };
}

interface Store {
  state: HouseholdState;
  loaded: boolean;
  update: (patch: Partial<HouseholdState>) => void;
  updateIntake: (patch: Partial<HouseholdIntake>) => void;
  updateGoals: (patch: Partial<GoalInputs>) => void;
  restore: (parsed: Partial<HouseholdState>) => void;
}

/** Merge a parsed object (storage load or a backup file) over the
 * defaults - the same tolerant shape for both, so a backup written by
 * any build restores into any later build. */
/** Role vocabulary bridge (owner QA round 28). The My House family
 * table speaks self/spouse/child/other; the engine intake model
 * speaks adult/dependent/student. The sync once copied the UI words
 * verbatim, so every member failed engine validation ("role must be
 * one of adult, dependent, student") and the household's accuracy
 * level was capped until fixed. Every family -> intake write goes
 * through this mapping, and coerceState migrates older saves. */
export function toEngineRole(uiRole: string, studentNow?: boolean): string {
  switch (uiRole) {
    case "self":
    case "spouse":
    case "adult":
      return "adult";
    case "student":
      return "student";
    case "child":
      return studentNow ? "student" : "dependent";
    default:
      return "dependent";
  }
}

export function coerceState(parsed: Partial<HouseholdState>): HouseholdState {
  const d = defaultState();
  const merged: HouseholdState = {
    ...d,
    ...parsed,
    intake: { ...d.intake, ...(parsed.intake ?? {}) },
    goals: { ...d.goals, ...(parsed.goals ?? {}) },
    family: (parsed.family ?? []).map((m) => ({ retireTarget: 0, ssAnnual: 0, ssClaimAge: 67, retireFlex: "fixed" as const, pensionAnnual: 0, eduTarget: 0, eduBalance: 0, eduMonthly: 0, eduAnnualCost: 0, eduInState: true, eduRoomBoard: true, eduScholarshipYear: 0, eduDurationYears: 4, ...m })),
    jobs: parsed.jobs ?? [],
    assets: parsed.assets ?? [],
    payrollCheck: parsed.payrollCheck ?? { lastConfirmedOn: null, consecutive: 0 },
    marketPush: parsed.marketPush ?? { consent: false, deviceSecret: null, syncedOn: null },
    eduAssignChildId: parsed.eduAssignChildId ?? null,
    events: parsed.events ?? [],
  };
  // Migrate legacy member roles saved before the vocabulary bridge:
  // any role outside the engine's three words is mapped now, using
  // the family table (matched by name) for the student flag.
  merged.intake = {
    ...merged.intake,
    members: (merged.intake.members ?? []).map((m) => {
      if (m.role === "adult" || m.role === "dependent" || m.role === "student") return m;
      const ui = merged.family.find((f) => f.name.trim() && f.name.trim() === (m.name ?? "").trim());
      return { ...m, role: toEngineRole(m.role, ui?.studentNow) as Member["role"] };
    }),
  };
  return merged;
}

const Ctx = createContext<Store | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HouseholdState>(defaultState());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) setState(coerceState(JSON.parse(raw) as HouseholdState));
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    if (loaded) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state)).catch(() => {});
  }, [state, loaded]);

  const store = useMemo<Store>(
    () => ({
      state,
      loaded,
      update: (patch) => setState((s) => ({ ...s, ...patch })),
      updateIntake: (patch) => setState((s) => ({ ...s, intake: { ...s.intake, ...patch } })),
      updateGoals: (patch) => setState((s) => ({ ...s, goals: { ...s.goals, ...patch } })),
      restore: (parsed) => setState(coerceState(parsed)),
    }),
    [state, loaded],
  );
  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

export function useHousehold(): Store {
  const store = useContext(Ctx);
  if (!store) throw new Error("useHousehold outside provider");
  return store;
}

export function todayIso(): string {
  // LOCAL calendar date - toISOString() is UTC and showed Phoenix users
  // tomorrow's date every evening (owner QA, 2026-11-07).
  const d = new Date();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}
