// Builds the deficiency letter as a PDF in the browser. jsPDF is loaded only when a letter is requested.
const fmt = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' });

export function deficiencies(data) {
  const { app, documents } = data;
  const items = [];
  for (const c of app.compliance.checks) {
    if (c.status !== 'fail' || ['docs_uploaded', 'docs_verified'].includes(c.key)) continue;
    items.push(`${c.label}: ${c.detail}.`);
  }
  for (const d of documents) {
    if (!d.doc) items.push(`${d.label}: not submitted. Upload the document.`);
    else if (d.doc.status === 'REJECTED')
      items.push(`${d.label}: rejected${d.doc.remark ? `. ${d.doc.remark.trim().replace(/\.+$/, '')}` : ''}. Upload a corrected copy.`);
    else if (d.doc.expiry_date && new Date(d.doc.expiry_date) < new Date()) items.push(`${d.label}: expired on ${fmt(d.doc.expiry_date)}. Upload a renewed certificate.`);
  }
  return items;
}

export async function downloadDeficiencyLetter(data, sla) {
  const { jsPDF } = await import('jspdf');
  const { app, institution, history } = data;
  const items = deficiencies(data);
  const remark = [...history].reverse().find((h) => h.to_status === 'ACTION_REQUIRED' || h.to_status === 'REJECTED')?.remark;
  // Give the institution the current deadline, or a fresh response window if that has already passed.
  const fresh = new Date(Date.now() + sla.responseDays * 86400000).toISOString();
  const respondBy = app.status === 'ACTION_REQUIRED' && new Date(app.due_date) > new Date() ? app.due_date : fresh;
  const today = new Date().toISOString();

  const doc = new jsPDF({ unit: 'pt', format: 'a4' });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 56;
  let y = M;
  const ensure = (h) => {
    if (y + h > H - 70) {
      doc.addPage();
      y = M;
    }
  };
  const para = (text, { size = 10.5, style = 'normal', gap = 6, indent = 0 } = {}) => {
    doc.setFont('helvetica', style).setFontSize(size);
    const lines = doc.splitTextToSize(text, W - M * 2 - indent);
    ensure(lines.length * size * 1.35);
    doc.text(lines, M + indent, y);
    y += lines.length * size * 1.35 + gap;
  };

  // Letterhead
  doc.setFillColor(20, 20, 20).rect(0, 0, W, 6, 'F');
  doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(20, 20, 20).text('AICTE Approvals', M, y + 4);
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(110, 108, 103).text('Approval Bureau  |  Deficiency report', M, y + 18);
  doc.text(`Ref: ${app.app_no}/DEF`, W - M, y + 4, { align: 'right' });
  doc.text(`Date: ${fmt(today)}`, W - M, y + 18, { align: 'right' });
  y += 40;
  doc.setDrawColor(228, 225, 218).line(M, y, W - M, y);
  y += 24;
  doc.setTextColor(20, 20, 20);

  para('To,', { gap: 2 });
  para(`The Principal / Director\n${institution.name}\n${[institution.city, institution.state].filter(Boolean).join(', ')}\nAICTE ID: ${institution.aicte_code}`, { gap: 14 });
  para(`Subject: Deficiencies in application ${app.app_no} (${app.category_label}, ${app.program}, AY ${app.academic_year})`, { style: 'bold', gap: 12 });
  para('Sir / Madam,', { gap: 8 });
  para(
    `Your application submitted on ${fmt(app.submitted_at)} has been scrutinised against the applicable norms. The following deficiencies were found and must be resolved before the application can be considered for approval:`,
    { gap: 10 }
  );

  if (items.length) items.forEach((t, i) => para(`${i + 1}.  ${t}`, { indent: 12, gap: 5 }));
  else para('No outstanding deficiencies are recorded at the time of this letter.', { indent: 12 });
  y += 6;

  if (remark) {
    para('Remarks of the scrutiny officer:', { style: 'bold', gap: 3 });
    para(remark, { gap: 10 });
  }
  para(
    `Please upload the required documents and corrections on the portal and resubmit the application by ${fmt(respondBy)}. If no response is received by this date, the application may be rejected without further notice.`,
    { gap: 22 }
  );

  ensure(70);
  para('Yours faithfully,', { gap: 20 });
  para(app.officer_name || 'Scrutiny Officer', { style: 'bold', gap: 2 });
  para(`${app.officer_designation || 'Scrutiny Officer'}${app.region ? `, ${app.region} Region` : ''}\nApproval Bureau`, { gap: 0 });

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(140, 138, 133);
    doc.text('System-generated from the approval portal record. Prototype for Smart India Hackathon; sample data.', M, H - 36);
    doc.text(`Page ${p} of ${pages}`, W - M, H - 36, { align: 'right' });
  }
  doc.save(`Deficiency-letter-${app.app_no}.pdf`);
}
