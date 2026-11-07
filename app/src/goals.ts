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
