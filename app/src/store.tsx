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
  stateRefundTargetLow: number;
  stateRefundTargetHigh: number;
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
    },
    onboarded: false,
  };
}

interface Store {
  state: HouseholdState;
  loaded: boolean;
  update: (patch: Partial<HouseholdState>) => void;
  updateIntake: (patch: Partial<HouseholdIntake>) => void;
  updateGoals: (patch: Partial<GoalInputs>) => void;
}

const Ctx = createContext<Store | null>(null);

export function HouseholdProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HouseholdState>(defaultState());
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((raw) => {
        if (raw) {
          const parsed = JSON.parse(raw) as HouseholdState;
          setState({
            ...defaultState(),
            ...parsed,
            intake: { ...defaultState().intake, ...parsed.intake },
            goals: { ...defaultState().goals, ...(parsed.goals ?? {}) },
          });
        }
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
  return new Date().toISOString().slice(0, 10);
}
