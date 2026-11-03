# GHIN → Excel (Automate → Run)

Pull **all** your GHIN scorecards into Excel: **Scores**, **Holes**, **Profile**, and optionally **HandicapHistory** — same shape as the [web exporter](https://ryanguild.github.io/ghin-exporter/).

**How you run it:** Excel **Automate** tab → **GhinPullAllData** → **Run**.  
That is the intended path for Microsoft 365 (Business/Education, and Home/Family when the Automate tab is available, including preview).

Read-only. No passwords are stored in these files.

---

## What you need

- **Excel on the web** or **Excel for Microsoft 365**
- An **Automate** tab (Office Scripts)
- **OneDrive** (script must live on OneDrive, not SharePoint — SharePoint blocks internet calls)

Home/Family: Automate may be preview; if you see the tab, you’re good.  
No Automate tab? Use the [Windows fallback](#fallback-no-automate-tab) at the bottom.

You do **not** need cloud Power Automate or a Premium connector.

> **Note:** Don’t launch this script from a cloud Power Automate **Run script** action — Excel can’t call GHIN that way (`fetch` is blocked). Use **Automate → Run** in Excel.

---

## Setup (once)

### 1. Add the script

From this folder:

- [`power-automate/GhinPullAllData.osts`](power-automate/GhinPullAllData.osts) — OneDrive import
- [`power-automate/GhinPullAllData.ts`](power-automate/GhinPullAllData.ts) — copy/paste source

**Import via OneDrive**

1. Copy `GhinPullAllData.osts` into OneDrive **`Documents/Office Scripts/`** (create the folder if needed).
2. Open Excel (web or Microsoft 365 desktop).
3. **Automate** → **All scripts** → **View more scripts** → choose `GhinPullAllData.osts`.

**Or paste**

1. **Automate** → **New Script**.
2. Replace the stub with the contents of `GhinPullAllData.ts`.
3. Save as `GhinPullAllData`.

### 2. Config sheet (email / password)

1. Open the workbook you’ll keep for golf data (blank is fine).
2. **Automate** → **GhinPullAllData** → **Run** once — it creates **Config** if missing.
3. Fill **Config**:

| Cell | Enter |
|------|--------|
| **B1** | GHIN email **or** GHIN number |
| **B2** | GHIN password |
| **B3** | `Yes` or `No` — handicap revision history |
| **B5** | *(status — script writes here)* |

Password in **B2 is cleared after a successful run**. Email in B1 stays for next time.

---

## Every time you pull

1. Type your password in **Config!B2** (and set B3 if you want history).
2. **Automate** → **GhinPullAllData** → **Run**.
3. Watch **Config!B5** (sign-in → “12/79”-style paging → writing sheets).
4. Open **Scores**, **Holes**, **Profile**, and **HandicapHistory** (if Yes).

Expect on the order of ~**79** rounds and ~**1,200** hole rows for a full season-shaped account. Some manually posted totals have empty hole detail — normal for GHIN.

---

## Safety / limits

- Read-only login + downloads only; never posts scores.
- ~750 ms between GHIN calls; stops on 401 / 403 / 429.
- Keep the `.osts` on **OneDrive**, not SharePoint.
- Browser alternative anytime: https://ryanguild.github.io/ghin-exporter/

---

## Fallback (no Automate tab)

Only if Excel has no Automate tab: Windows **Power Automate Desktop** + [`power-automate/GhinPull-ToExcel.ps1`](power-automate/GhinPull-ToExcel.ps1). See [`power-automate/power-automate-desktop-recipe.md`](power-automate/power-automate-desktop-recipe.md).
