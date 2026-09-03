import { jsPDF } from 'jspdf';
import QRCode from 'qrcode';
import ckhLogoUrl from '@/assets/brand/ckh-logo.png';

// Pulled from capturingkidshearts.org's live site (header/button color and
// logo) so the printed flyer reads as genuinely on-brand rather than a
// generic QR code stapled to the booth table.
const CKH_NAVY = '#215091';
const CKH_GOLD = '#D4A24C';
const CREAM = '#FBF6EA';

let cachedLogoDataUrl: string | null = null;

async function urlToDataUrl(url: string): Promise<string> {
  const blob = await fetch(url).then((r) => r.blob());
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

async function getLogoDataUrl(): Promise<string> {
  cachedLogoDataUrl ??= await urlToDataUrl(ckhLogoUrl);
  return cachedLogoDataUrl;
}

export interface FlyerDetails {
  eventName: string;
  city: string;
  state: string;
  intakeUrl: string;
}

// Builds a print-ready, CKH-branded "scan to connect" flyer and triggers a
// browser download — this is the PDF a rep prints and sets on the booth
// table, replacing the old on-screen "point your phone at the laptop" QR.
export async function generateFlyerPdf(details: FlyerDetails): Promise<void> {
  const [logoDataUrl, qrDataUrl] = await Promise.all([
    getLogoDataUrl(),
    QRCode.toDataURL(details.intakeUrl, { width: 900, margin: 1, color: { dark: CKH_NAVY, light: '#FFFFFF' } }),
  ]);

  const doc = new jsPDF({ unit: 'pt', format: 'letter' });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const centerX = pageWidth / 2;

  // Background + nested border frame, echoing the layered-border look of
  // CKH's printed collateral without trying to reproduce their exact
  // hand-drawn squiggle art.
  doc.setFillColor(CREAM);
  doc.rect(0, 0, pageWidth, pageHeight, 'F');

  doc.setDrawColor(CKH_NAVY);
  doc.setLineWidth(2);
  doc.roundedRect(28, 28, pageWidth - 56, pageHeight - 56, 16, 16);
  doc.setDrawColor(CKH_GOLD);
  doc.setLineWidth(1);
  doc.roundedRect(40, 40, pageWidth - 80, pageHeight - 80, 12, 12);

  // Logo
  const logoWidth = 300;
  const logoHeight = logoWidth * (437 / 1500);
  doc.addImage(logoDataUrl, 'PNG', centerX - logoWidth / 2, 84, logoWidth, logoHeight);

  // Headline
  doc.setTextColor(CKH_NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(40);
  doc.text('CONNECT WITH US', centerX, 84 + logoHeight + 56, { align: 'center' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(15);
  doc.text(`${details.eventName}`, centerX, 84 + logoHeight + 84, { align: 'center' });
  doc.setFontSize(12);
  doc.setTextColor('#5B6472');
  doc.text(`${details.city}, ${details.state}`, centerX, 84 + logoHeight + 104, { align: 'center' });

  // QR code, boxed in white so it stays scannable against the cream page
  const qrSize = 260;
  const qrY = 84 + logoHeight + 132;
  doc.setFillColor('#FFFFFF');
  doc.setDrawColor(CKH_NAVY);
  doc.setLineWidth(1.5);
  doc.roundedRect(centerX - qrSize / 2 - 16, qrY - 16, qrSize + 32, qrSize + 32, 10, 10, 'FD');
  doc.addImage(qrDataUrl, 'PNG', centerX - qrSize / 2, qrY, qrSize, qrSize);

  // URL, spelled out for anyone who can't scan
  doc.setTextColor(CKH_NAVY);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  const urlText = details.intakeUrl.replace(/^https?:\/\//, '');
  doc.text(urlText, centerX, qrY + qrSize + 48, { align: 'center' });

  doc.save(`ckh-connect-flyer-${details.city.toLowerCase().replace(/\s+/g, '-')}.pdf`);
}
