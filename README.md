# Claude Skills Runner — Home Assistant Add-on

Kør Claude Code skills (madplan, brugerdefinerede prompts) direkte fra Home Assistant med en web UI der viser processen og resultater.

## Features

- **Web UI** (via HA ingress) — se live output mens skills kører, historik over alle kørsler
- **Scheduler** — kør skills automatisk via cron (fx madplan hver søndag)
- **HA Sensorer** — resultater pushes som sensorer til brug i dashboard/automationer
- **Manuel trigger** — kør skills on-demand fra UI'en eller via HA service calls

## Installation

### 1. Tilføj add-on repository

I Home Assistant:
1. Gå til **Settings → Add-ons → Add-on Store**
2. Klik **⋮** (tre prikker øverst til højre) → **Repositories**
3. Tilføj URL'en til dette repository (eller upload manuelt via Samba/SSH)
4. Find "Claude Skills Runner" i listen og klik **Install**

### 2. API-nøgle

1. Gå til add-on'ets **Configuration** tab
2. Indtast din Anthropic API key i `api_key` feltet
3. Gem og genstart add-on'et

Nøglen gemmes sikkert i add-on'ets konfiguration og bruges automatisk ved hver kørsel.

### 3. Konfiguration

Under add-on **Configuration** tab, tilføj dine skills og schedules:

```yaml
skills:
  - name: madplan
    prompt: "Generér madplan for næste uge"
    schedule: "0 10 * * 0"
log_level: info
```

Schedule bruger standard cron-format: `minut time dag-i-måned måned ugedag`
- `0 10 * * 0` = søndag kl. 10:00
- `0 8 * * 1` = mandag kl. 08:00

### 4. Dashboard-kort

Tilføj et Markdown-kort til dit HA dashboard der viser den seneste madplan:

```yaml
type: markdown
title: Ugens Madplan
content: "{{ state_attr('sensor.claude_skill_madplan', 'output_markdown') }}"
```

Eller et mere avanceret kort med status:

```yaml
type: vertical-stack
cards:
  - type: entities
    entities:
      - entity: sensor.claude_skill_madplan
        name: Madplan Status
        icon: mdi:food
  - type: markdown
    title: Madplan
    content: >
      {% if state_attr('sensor.claude_skill_madplan', 'output_markdown') %}
        {{ state_attr('sensor.claude_skill_madplan', 'output_markdown') }}
      {% else %}
        *Ingen madplan genereret endnu. Kør den manuelt fra Claude Skills panelet.*
      {% endif %}
```

### 5. Automation-eksempel

Trigger madplan automatisk + send notifikation når den er klar:

```yaml
automation:
  - alias: "Ugentlig madplan"
    trigger:
      - platform: time
        at: "10:00:00"
    condition:
      - condition: time
        weekday:
          - sun
    action:
      - service: rest_command.run_claude_skill
        data:
          skill: madplan
          prompt: "Generér madplan for næste uge"

  - alias: "Madplan klar notifikation"
    trigger:
      - platform: state
        entity_id: sensor.claude_skill_madplan
        to: "completed"
    action:
      - service: notify.mobile_app
        data:
          title: "Madplan klar!"
          message: "Ugens madplan er genereret. Tjek den i Home Assistant."

rest_command:
  run_claude_skill:
    url: "http://localhost:8099/api/run"
    method: POST
    content_type: "application/json"
    payload: '{"skill": "{{ skill }}", "prompt": "{{ prompt }}", "triggeredBy": "automation"}'
```

## Brug af Web UI

Klik **Claude Skills** i HA sidepanelet (tilføjet automatisk via ingress). Her kan du:

- **Kør Madplan** — starter skill'en med ét klik
- **Kør brugerdefineret prompt** — kør en vilkårlig Claude-prompt
- **Se live output** — klik på en kørsel for at se output streame live
- **Historik** — alle tidligere kørsler med status og output

## Tilføj egne skills

Læg en `.md` fil i add-on'ets config-mappe (`/addon_configs/local_claude_skills_runner/skills/`):

```markdown
---
name: min-skill
description: Beskrivelse af hvad skill'en gør
---

# Instruktioner til Claude

[Din prompt/instruktioner her]
```

## Fejlfinding

- **"API-nøgle mangler"** — Gå til add-on Configuration og indtast din Anthropic API key
- **Ingen output** — Tjek add-on loggen under **Log** tab
- **Sensor opdateres ikke** — Tjek at SUPERVISOR_TOKEN er tilgængelig (automatisk i add-ons)
- **Kørsel fejler** — Tjek at API-nøglen er gyldig og har kredit på console.anthropic.com
