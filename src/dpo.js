const { XMLParser } = require('fast-xml-parser');

const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
const live = () => !!process.env.DPO_COMPANY_TOKEN;
// The mock gateway lets anyone "pay" for free, so it is refused on production unless explicitly allowed.
const mockAllowed = () => process.env.NODE_ENV !== 'production' || process.env.ALLOW_MOCK_PAYMENTS === '1';

// In-memory state for the built-in mock gateway (testing without DPO credentials).
const mock = new Map();

const ENT = { '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' };
const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (c) => ENT[c]);

async function call(xml) {
  const res = await fetch(process.env.DPO_API_URL || 'https://secure.3gdirectpay.com/API/v6/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/xml' },
    body: xml,
  });
  return parser.parse(await res.text()).API3G || {};
}

// Returns { token, ref, payUrl } for an order.
async function createToken({ order, description, appUrl }) {
  if (!live()) {
    if (!mockAllowed()) throw new Error('DPO_COMPANY_TOKEN is not set: payments are disabled until DPO is configured.');
    const token = `MOCK-${order.id}-${Math.random().toString(36).slice(2, 10)}`;
    mock.set(token, 'pending');
    return { token, ref: token, payUrl: `${appUrl}/api/payments/mock?token=${token}` };
  }
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
  const r = await call(`<?xml version="1.0" encoding="utf-8"?><API3G>
    <CompanyToken>${esc(process.env.DPO_COMPANY_TOKEN)}</CompanyToken><Request>createToken</Request>
    <Transaction><PaymentAmount>${Number(order.total).toFixed(2)}</PaymentAmount>
      <PaymentCurrency>${esc(order.currency)}</PaymentCurrency><CompanyRef>${order.id}</CompanyRef>
      <RedirectURL>${esc(appUrl)}/api/payments/return</RedirectURL>
      <BackURL>${esc(appUrl)}/api/payments/cancel?order=${order.id}</BackURL>
      <CompanyRefUnique>0</CompanyRefUnique><PTL>30</PTL></Transaction>
    <Services><Service><ServiceType>${esc(process.env.DPO_SERVICE_TYPE)}</ServiceType>
      <ServiceDescription>${esc(description).slice(0, 200)}</ServiceDescription>
      <ServiceDate>${date}</ServiceDate></Service></Services></API3G>`);
  if (String(r.Result) !== '000') throw new Error(`DPO createToken failed: ${r.Result} ${r.ResultExplanation}`);
  return {
    token: String(r.TransToken),
    ref: String(r.TransRef),
    payUrl: `${process.env.DPO_PAY_URL || 'https://secure.3gdirectpay.com/payv3.php'}?ID=${r.TransToken}`,
  };
}

// Returns { status: 'paid'|'pending'|'failed'|'cancelled', ref }
async function verifyToken(token) {
  if (!live()) return { status: mock.get(token) || 'failed', ref: token };
  const r = await call(`<?xml version="1.0" encoding="utf-8"?><API3G>
    <CompanyToken>${esc(process.env.DPO_COMPANY_TOKEN)}</CompanyToken><Request>verifyToken</Request>
    <TransactionToken>${esc(token)}</TransactionToken></API3G>`);
  const code = String(r.Result);
  const status = code === '000' ? 'paid' : code === '900' ? 'pending' : code === '904' ? 'cancelled' : 'failed';
  return { status, ref: r.TransactionApproval ? String(r.TransactionApproval) : token, raw: code };
}

const setMock = (token, status) => { if (mock.has(token)) mock.set(token, status); };

module.exports = { live, mockAllowed, createToken, verifyToken, setMock };
