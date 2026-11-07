"""US-Israel income tax treaty (Phase 1, in full per the owner decision
of 2026-11-07). Provisions live in the treaty-us-il content pack; this
module applies them and always states the saving-clause effect: for a US
citizen, most treaty exemptions do not reduce US tax - the operative
benefit is the foreign tax credit (foreign.py) plus the few articles
that survive the clause.
"""
from dataclasses import dataclass
from typing import Optional

from .packs import load_pack


def _pack(pack: dict | None = None) -> dict:
    return pack or load_pack("treaty-us-il")


@dataclass
class WithholdingResult:
    income_type: str
    treaty_cap_rate: float
    article_note: str


def withholding_cap(income_type: str, *, corporate_10pct: bool = False,
                    financial_institution: bool = False, government_backed: bool = False,
                    copyright_royalty: bool = False,
                    pack: dict | None = None) -> WithholdingResult:
    caps = _pack(pack)["withholding_caps"]
    if income_type == "dividends":
        if corporate_10pct:
            return WithholdingResult(income_type, caps["dividends_direct_corporate_10pct"],
                                     "Direct dividend: recipient company owns >= 10% of voting power - cap 12.5%.")
        return WithholdingResult(income_type, caps["dividends_general"],
                                 "General dividend cap 25%.")
    if income_type == "interest":
        if government_backed:
            return WithholdingResult(income_type, caps["interest_government_backed"],
                                     "Government-guaranteed or government-derived interest - exempt in the source state.")
        if financial_institution:
            return WithholdingResult(income_type, caps["interest_financial_institution"],
                                     "Interest on a loan from a bank, savings institution or insurance company - cap 10%.")
        return WithholdingResult(income_type, caps["interest_general"], "General interest cap 17.5%.")
    if income_type == "royalties":
        if copyright_royalty:
            return WithholdingResult(income_type, caps["royalties_copyright"],
                                     "Copyright and film royalties - cap 10%.")
        return WithholdingResult(income_type, caps["royalties_industrial"],
                                 "Industrial royalties - cap 15%.")
    raise ValueError(f"No treaty withholding cap for income type: {income_type}")


@dataclass
class TreatyPosition:
    topic: str
    taxable_in: str
    saving_clause_overrides: bool
    note: str


def treaty_position(topic: str, *, us_citizen: bool, pack: dict | None = None) -> TreatyPosition:
    positions = _pack(pack)["positions"]
    if topic not in positions:
        raise ValueError(f"Unknown treaty topic: {topic}")
    p = positions[topic]
    if topic == "social_security_benefits":
        return TreatyPosition(topic, p["taxable_in"], False, p["note"])  # survives the clause
    if us_citizen:
        return TreatyPosition(topic, p["taxable_in"], True,
                              p["note"] + " Saving clause (Art. 6(3)): the US may still tax its citizen; relief comes via the foreign tax credit.")
    return TreatyPosition(topic, p["taxable_in"], False, p["note"])
