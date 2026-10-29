# Live demo: a principal applies for "B.E. Data Science"

Site: https://approvals2321.vercel.app. All documents here are fictional samples, marked as such on every page.

## The documents

| # | Document (portal slot) | Correct file | Faulty file | What's wrong with the faulty one | Who catches it |
|---|---|---|---|---|---|
| 1 | Faculty list with qualifications | `correct/01_Faculty_List_CORRECT.pdf` | `faulty/01_Faculty_List_FAULTY.pdf` | Only 10 faculty (12 are needed for intake 60), no qualifications column, not signed | **The officer** (passes the automatic check on purpose, to show human review) |
| 2 | Laboratory & equipment details | `correct/02_Lab_Details_CORRECT.pdf` | none | | |
| 3 | Curriculum & syllabus | `correct/03_Curriculum_CORRECT.pdf` | `faulty/03_Curriculum_FAULTY.pdf` | It's actually the **fee structure**, uploaded into the wrong slot | **Automatic check**: "may be the wrong document" |
| 4 | Notarised affidavit | `correct/04_Affidavit_CORRECT.pdf` | none | | |
| 5 | University / Board affiliation consent | `correct/05_University_Affiliation_CORRECT.pdf` | `faulty/05_University_Affiliation_FAULTY.pdf` | Issued to a **different college** (Deccan Valley Institute of Technology) for a different program | **Automatic check**: "institution name does not appear" |

## Before the demo (once)

1. Sign in as **Administrator** (`admin@aicte.demo` / `demo123`), go to **Users & officers**, and switch **Auto-assign** off for **Dr. Sameer Kulkarni**. A new Pune application then goes to **Rajiv Menon**, whose login you have (`officer@aicte.demo`). Switch it back on after the demo.
2. Make sure Supabase → Authentication → URL Configuration → Site URL is `https://approvals2321.vercel.app`, so the sign-up email works.

## 1. Register the college (principal)

On the sign-in page choose **Register for an account** and enter these exactly. The documents name this college, so the name must match:

| Field | Value |
|---|---|
| Institution name | `Sahyadri Institute of Engineering & Technology` |
| Institution type | Engineering |
| AICTE ID | leave blank |
| City / State | Pune / Maharashtra |
| AICTE region | West |
| Principal's name | Dr. Kavita Deshmukh |
| Email / password | your own real email, and a password of 8+ characters |

Enter the code (or click the link) from the email to finish.

## 2. Apply (principal)

**New application** → fill in:

| Field | Value |
|---|---|
| Category | New Course / Program |
| Program / course name | `B.E. Data Science` |
| Academic year | 2027-28 |
| Duration | 4 |
| Proposed intake | 60 |
| Regular faculty | 13 |
| Land area | 10 |
| Built-up area | 8000 |

Point out the **Readiness check** filling in live. (Optional: type 10 faculty to show the ratio check fail, then change it back to 13.)

Attach: **01 FAULTY, 02 correct, 03 FAULTY, 04 correct, 05 FAULTY**, then **Submit application**.
Show the auto-assignment to Rajiv Menon and the **automatic check** notes on documents 3 and 5.

## 3. Review (officer: `officer@aicte.demo`)

1. Open the application from the bell or the list, then choose **Start review**.
2. Open each flagged document and show the automatic notes.
3. **Reject** them with remarks:
   - 01 Faculty list: "Only 10 faculty listed; 12 are required for intake 60. Add qualifications and the Principal's signature."
   - 03 Curriculum: "This is the fee structure, not the curriculum. Upload the university-approved syllabus."
   - 05 Affiliation: "This consent letter is for Deccan Valley Institute of Technology. Upload the consent issued to your college for B.E. Data Science."
4. **Verify** 02 and 04.
5. Try **Approve**: it's blocked, and lists the unmet checks.
6. Download the **Deficiency letter** (PDF) to show it lists all three problems.
7. Type a remark and choose **Request action from institution**.

## 4. Fix and resubmit (principal)

1. Show the alert in the bell and the "AICTE has requested action" banner.
2. **Replace** documents 01, 03 and 05 with the **correct** files. The automatic check now passes.
3. Optionally send a **Message**: "Corrected documents uploaded."
4. Choose **Resubmit for review**.

## 5. Approve (officer)

Verify 01, 03 and 05. Every check now passes, so **Approve**. The principal sees "Approved".
Finish on the **Audit trail** (admin) to show every step recorded.
