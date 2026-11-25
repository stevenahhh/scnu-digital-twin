from __future__ import annotations

import json
import re
import unicodedata
from pathlib import Path
from typing import Final, Literal

from pydantic import BaseModel, ConfigDict

Kind = Literal["any", "building", "road", "crosswalk", "node", "zone"]
DATA_FILE: Final = Path(__file__).resolve().parents[2] / "common/data/common_elemetns.json"
ALIASES: Final = {
    "공대": "공과대학", "생명대": "생명산업과학대학",
    "본관": "대학본부", "기숙사": "학생생활관",
}


class Place(BaseModel):
    model_config = ConfigDict(frozen=True)
    element_id: str
    name: str
    element_type: str
    zone_id: str | None = None


class Zone(BaseModel):
    model_config = ConfigDict(frozen=True)
    zone_id: str
    zone_name: str


class CampusData(BaseModel):
    model_config = ConfigDict(frozen=True)
    elements: tuple[Place, ...]
    zones: tuple[Zone, ...]


def normalize(text: str) -> str:
    text = unicodedata.normalize("NFKC", text).casefold()
    for alias, full in ALIASES.items():
        text = text.replace(alias, full)
    return "".join(char for char in text if char.isalnum())


class Places:
    def __init__(self) -> None:
        self.raw = json.loads(DATA_FILE.read_text(encoding="utf-8"))
        self.data = CampusData.model_validate(self.raw)
        self.by_id = {place.element_id: place for place in self.data.elements}
        self.entries = (*self.data.elements, *(
            Place(element_id=zone.zone_id, name=zone.zone_name,
                  element_type="zone", zone_id=zone.zone_id)
            for zone in self.data.zones
        ))

    def find(self, query: str, kind: Kind = "any", limit: int = 5) -> list[Place]:
        needle = normalize(query)
        if not needle:
            return []
        tokens = {normalize(part) for part in re.findall(r"\w+", query) if normalize(part)}
        matches = []
        for place in self.entries:
            if kind != "any" and place.element_type != kind:
                continue
            identifier, name = normalize(place.element_id), normalize(place.name)
            code = normalize(place.element_id.removeprefix("BLD_"))
            overlap = sum(token in name for token in tokens)
            if needle in {identifier, code}:
                score = (0, 0, place.element_id)
            elif needle == name:
                score = (1, 0, place.element_id)
            elif needle in name or needle in identifier:
                score = (2, len(name), place.element_id)
            elif overlap:
                score = (3, -overlap, place.element_id)
            else:
                continue
            matches.append((score, place))
        return [place for _, place in sorted(matches, key=lambda pair: pair[0])[:limit]]

    def tsv(self) -> str:
        return "\n".join([
            "id\tname\ttype\tzone",
            *("\t".join((p.element_id, p.name, p.element_type, p.zone_id or ""))
              for p in self.data.elements),
        ])
