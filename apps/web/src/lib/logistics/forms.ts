import {
  holdingsDeclaration,
  kitToString,
  SIGNOUT_DECLARATION,
  type FormLine,
  type KitLine,
  type LogisticsFormData,
} from "@gdud/core";
import type { PersonVM } from "./data";
import { fmtDate } from "./format";

/** The soldier fields printed on a form. */
export type FormPerson = Pick<PersonVM, "name" | "personalNumber" | "companyName" | "platoonName" | "phone">;

interface FormInput {
  battalion: string;
  person: FormPerson;
  issuedBy: string;
  signer: string;
  issuedAt?: Date;
}

const personCard = (p: FormPerson): LogisticsFormData["person"] => ({
  name: p.name,
  personalNumber: p.personalNumber,
  company: p.companyName,
  platoon: p.platoonName,
  phone: p.phone,
});

/** טופס החתמת ציוד — the items handed over now. */
export function signOutForm(
  input: FormInput & { notes: string; lines: Array<{ item: string; serial: string; kit: readonly KitLine[] }> },
): LogisticsFormData {
  return {
    title: "טופס החתמת ציוד",
    battalion: input.battalion,
    issuedAt: (input.issuedAt ?? new Date()).toISOString(),
    person: personCard(input.person),
    lines: input.lines.map((l) => ({ item: l.item, serial: l.serial, kit: kitToString(l.kit) })),
    notes: input.notes,
    signer: input.signer,
    signerTitle: "מחתים",
    issuedBy: input.issuedBy,
    declaration: SIGNOUT_DECLARATION,
  };
}

/** טופס ציוד חתום — everything signed to the soldier right now. */
export function holdingsForm(
  input: FormInput & {
    lines: Array<{ item: string; serial: string; kit: readonly KitLine[]; notes: string | null; signedAt: Date }>;
  },
): LogisticsFormData {
  const issuedAt = input.issuedAt ?? new Date();
  const lines: FormLine[] = input.lines.map((l) => ({
    item: l.item,
    serial: l.serial,
    kit: kitToString(l.kit),
    notes: l.notes ?? "",
    signedAt: l.signedAt.toISOString(),
  }));
  return {
    title: "טופס ציוד חתום",
    battalion: input.battalion,
    issuedAt: issuedAt.toISOString(),
    person: personCard(input.person),
    lines,
    notes: "",
    signer: input.signer,
    signerTitle: "מאשר",
    issuedBy: input.issuedBy,
    declaration: holdingsDeclaration(fmtDate(issuedAt)),
  };
}
