// Goal projection helper for the dashboard gauges.
// Compound growth with monthly contributions. The assumed return is an
// explicit, editable input - labelled on screen, never hidden.
export function projectValue(balance: number, monthly: number, years: number, annualReturnPct: number): number {
  const months = Math.max(0, Math.round(years * 12));
  const r = annualReturnPct / 100 / 12;
  if (months === 0) return balance;
  if (r === 0) return balance + monthly * months;
  const growth = Math.pow(1 + r, months);
  return balance * growth + monthly * ((growth - 1) / r);
}

export function goalPct(projected: number, target: number): number | null {
  if (target <= 0) return null; // no target set - the gauge says so instead of faking a number
  return Math.round((projected / target) * 100);
}

export function ageOn(dob: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  let age = ty - y;
  if (tm < m || (tm === m && td < d)) age -= 1;
  return age;
}

/** Plain-language education line for one child, from the My House table. */
export function educationLine(name: string, dob: string, studentNow: boolean, collegeStartYear: number, yearsLeft: number, today: string): string {
  const age = ageOn(dob, today);
  if (studentNow) return `${name}: in college now${yearsLeft > 0 ? `, about ${yearsLeft} year${yearsLeft === 1 ? "" : "s"} left` : ""}.`;
  if (collegeStartYear > 0) {
    const years = collegeStartYear - Number(today.slice(0, 4));
    return `${name}: starts college in ${collegeStartYear}${years > 0 ? ` (${years} year${years === 1 ? "" : "s"})` : ""}.`;
  }
  if (age !== null) {
    const startYear = Number(today.slice(0, 4)) + (18 - age);
    return `${name}: age ${age} - college around ${startYear} if they start at 18.`;
  }
  return `${name}: add a date of birth in My House to time the education savings.`;
}

/** Rough rule-of-thumb retirement need: 25x the income you want to
 * replace, at a 70% replacement rate. Always labelled as a rule of
 * thumb on screen - an estimate the user can accept or override. */
export function retirementNeedEstimate(annualIncome: number): number {
  if (annualIncome <= 0) return 0;
  return Math.round(annualIncome * 0.7 * 25);
}

/** Monthly contribution needed to reach a target from a balance in a
 * given number of years (the inverse of projectValue). */
export function requiredMonthly(balance: number, target: number, years: number, annualReturnPct: number): number {
  const months = Math.max(0, Math.round(years * 12));
  if (months === 0) return 0;
  const r = annualReturnPct / 100 / 12;
  if (r === 0) return Math.max(0, (target - balance) / months);
  const growth = Math.pow(1 + r, months);
  return Math.max(0, ((target - balance * growth) * r) / (growth - 1));
}

/** Earliest age (searching fromAge..capAge) at which the projected
 * value reaches the need - the "when IS it realistic" answer. */
export function earliestAgeReaching(balance: number, monthly: number, need: number, annualReturnPct: number, currentAge: number, fromAge: number, capAge = 80): number | null {
  for (let age = Math.max(fromAge, currentAge); age <= capAge; age++) {
    if (projectValue(balance, monthly, age - currentAge, annualReturnPct) >= need) return age;
  }
  return null;
}

export interface EducationFunding {
  needAtStart: number;      // total inflated net cost of all college years, valued at start
  projectedAtStart: number; // savings projected to the start date
  gap: number;
  pctFunded: number | null; // null when there is no cost estimate yet
  requiredMonthly: number;  // contribution that closes the gap by the start
}

/** SPEC45 sec. 32 core: per-child funding status. Costs inflate at
 * inflationPct per year until each college year arrives; scholarships
 * reduce each year; contributions run until college starts. */
export function educationFunding(balance: number, monthly: number, yearsToStart: number, durationYears: number,
  annualCost: number, scholarshipPerYear: number, annualReturnPct: number, inflationPct = 3): EducationFunding {
  const net = Math.max(0, annualCost - scholarshipPerYear);
  let needAtStart = 0;
  for (let i = 0; i < Math.max(0, durationYears); i++) {
    const inflated = net * Math.pow(1 + inflationPct / 100, yearsToStart + i);
    needAtStart += inflated / Math.pow(1 + annualReturnPct / 100, i); // later years discounted back to start
  }
  const projectedAtStart = projectValue(balance, monthly, yearsToStart, annualReturnPct);
  const gap = Math.max(0, needAtStart - projectedAtStart);
  return {
    needAtStart: Math.round(needAtStart),
    projectedAtStart: Math.round(projectedAtStart),
    gap: Math.round(gap),
    pctFunded: needAtStart > 0 ? Math.round((projectedAtStart / needAtStart) * 100) : null,
    requiredMonthly: Math.round(requiredMonthly(balance, needAtStart, yearsToStart, annualReturnPct)),
  };
}
