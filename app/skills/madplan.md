---
name: madplan
description: Genererer en ugentlig madplan (man-fre) med sunde opskrifter, indkøbsliste og hurtig tilberedning
---

# Ugentlig Madplan Skill

## Formål
Generer en komplet madplan for mandag-fredag med opskrifter og samlet indkøbsliste.

## Krav til madplanen

### Kostprincipper
- **Sundt og næringsrigt**: Fokus på fuldkorn, grøntsager, bælgfrugter og magert kød
- **Bælgfrugter i mindst 3 af 5 retter**: Kikærter, linser, sorte bønner, hvide bønner, edamame etc.
- **Protein i hver ret**: Kylling, oksekød, svinekød, lam, kalkunfars, INGEN fisk
- **Laktosefri**: Ingen mælkeprodukter med laktose. Brug laktosefri alternativer (laktosefri ost, havre-/kokos-/mandelmælk, laktosefri fløde, plantebaseret smør) eller undgå mejeri helt
- **Masser af grønt**: Avokado, agurk, spinat, grønkål, tomater, peberfrugter, søde kartofler etc.
- **Sunde fedtstoffer**: Nødder, frø, olivenolie, avokado
- **Fuldkorn**: Fuldkornspasta, bulgur, quinoa, ris, fuldkornsbrød
- **Ingen "pasta kødsovs"** — men gerne lasagne med kød og linser, pasta med andre saucer
- **Variation**: Forskellige køkkentyper (mexicansk, asiatisk, middelhavs, nordisk, indisk)

### Tilberedning
- Max 30-45 minutter aktiv tilberedningstid
- Realistiske hverdagsretter — ikke komplicerede teknikker
- Gerne one-pot/one-pan hvor muligt

### Målgruppe
- Skal appellere til en 18-årig dreng (mættende, smagsfuldt, ikke for "hippie")
- Undgå retter der udelukkende er salat — der skal fylde/substans i
- Gerne kendte koncepter med sundt twist (wraps, bowls, tacos, burger etc.)

### Sportsernæring — Elitefodbold
Sønnen spiller fodbold på eliteniveau med daglig træning og weekendkampe. Madplanen (man-fre) skal optimere energi til træning og restitution.

**Makrofordeling (hverdage/træningsdage):**
- ~60-70% kulhydrater (komplekse: fuldkornspasta, ris, kartofler, quinoa, bulgur, havregryn)
- ~1,5-2,0 g protein pr. kg kropsvægt (kylling, oksekød, bælgfrugter, æg)
- Sunde fedtstoffer (avokado, nødder, olivenolie)

**Principper for hverdagsretter:**
- Aftensmaden skal være kulhydratrig og proteinholdig — altid en solid kulhydratkilde som base (pasta, ris, kartofler, bulgur, couscous, brød)
- Portioner skal være mættende nok til en elite-atlet i vækst — angiv gerne større portioner til sønnen
- Retter skal understøtte restitution efter eftermiddags-/aftentræning
- Undgå for lette eller for fiberrige retter der ikke giver nok energi

**Forslag til mellemmåltider (inkluder som note i madplanen):**
- Før træning: Banan, energibar, havregryn med frugt
- Efter træning (inden for 30 min): Proteinshake med banan, laktosefri kakaomælk, grovbolle med kylling
- Generelt: Nødder, frugt, ris-kager med peanutbutter

**Bemærk:** Weekender (kampdage + kulhydrat-loading) styres selv — madplanen dækker KUN mandag-fredag.

### Sæsonens grøntsager og frugt
Brug FORTRINSVIST grøntsager og frugt der er i sæson for den aktuelle måned. Det giver bedre smag, lavere pris og mere bæredygtighed. Undersøg hvad der er i sæson for den aktuelle uge/måned baseret på dansk sæsonkalender.

### Inspirationskilder
- Valdemarsro.dk (nem hverdagsmad-konceptet)
- AUH's 10 kostråd: spis varieret, masser af grønt, fuldkorn, bælgfrugter, sunde fedtstoffer
- spisbedre.dk — sæsonkalender for dansk frugt og grønt

## Output-format

Generer madplanen i følgende markdown-format:

```
# Madplan uge [ugenummer] — [datointerval]

**Sæson-fokus ([måned]):** [liste over sæsonens grøntsager der bruges i denne uges retter]

**Meal prep søndag:** [Forslag til forberedelse man kan lave søndag for at spare tid i ugen]

**Husk i tide:**
- [Ting der skal tages op af fryseren AFTENEN FØR den dag de skal bruges]
- [Ting der skal ligge i blød natten over]
- VIGTIG: Medtag KUN ting der faktisk kræver handling.
- Angiv altid HVILKEN aften/dag handlingen skal ske.

---

## Mandag: [Ret-navn]
![Ret-navn](image-search:ENGLISH_DESCRIPTION_OF_FINISHED_DISH)
**Tid:** X min | **Protein:** X | **Bælgfrugt:** X (hvis relevant)

### Ingredienser (3 pers)
- ...

### Fremgangsmåde
1. ...

---

[gentag for tirsdag-fredag]

---

# Indkøbsliste uge [ugenummer]

### Kød
- ...

### Grøntsager & frugt
- ...

### Bælgfrugter & korn
- ...

### Mejeri (laktosefri)
- ...

### Krydderier & andet
- ...

### Har du sandsynligvis i forvejen
- Salt, peber, olivenolie, hvidløg...
```

## Vigtige noter
- Portioner: 3 personer (medmindre andet angivet)
- Indkøbslisten skal være samlet for hele ugen og sorteret efter supermarkedets afdelinger
- Marker ingredienser der kan genbruges på tværs af ugens retter
- **Billede pr. ret**: Inkluder ÉN linje `![Ret-navn](image-search:QUERY)` umiddelbart efter hver dags H2-overskrift. QUERY skal være på engelsk og beskrive den færdige ret visuelt (f.eks. "chicken tikka masala bowl with rice and naan bread"). Brug IKKE danske navne i søgeforespørgslen.
