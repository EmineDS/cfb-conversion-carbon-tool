// Dönüşüm karbon ve maliyet aracı: hesap modeli.
// hesap.py (sürüm 2, 29 Ekim 2026) satır satır JS'e taşındı. Aynı girdiyle aynı sayıları vermeli.
// Birimler: aksi yazılmadıkça her şey "1 MWh buhar" başına (fonksiyonel birim).

(function (root) {
  // ---------------------------------------------------------------- mol kütleleri (IUPAC)
  const A = { C: 12.011, H: 1.008, O: 15.999, N: 14.007, S: 32.06, Ca: 40.078, Mg: 24.305 };
  const MW = {
    C: A.C, H: A.H, S: A.S, N: A.N,
    O2: 2 * A.O, N2: 2 * A.N, CO2: A.C + 2 * A.O, H2O: 2 * A.H + A.O,
    SO2: A.S + 2 * A.O, NH3: A.N + 3 * A.H, CH4: A.C + 4 * A.H,
    CaCO3: A.Ca + A.C + 3 * A.O, CaO: A.Ca + A.O, CaSO4: A.Ca + A.S + 4 * A.O,
    MgCO3: A.Mg + A.C + 3 * A.O, MgO: A.Mg + A.O,
  };
  const GJ_per_MWh = 3.6;

  // ---------------------------------------------------------------- ülke profilleri
  // Ülkeye özel değerler burada; teknolojiye özel değerler aşağıdaki VARSAYILAN içinde.
  const ULKELER = {
    PL: {
      ad: { tr: "Polonya", en: "Poland" },
      mine_ch4: 9.77,          // kg CH4 / t kömür, NID 2026 Tablo 3.3.1 ve 3.3.2 (8,09 + 1,675)
      mining_co2: 56.6 / 21.43, // g CO2e/MJ, GUS 2025 Tabl. 3(29) + Lewandowska 2025 şebeke 0,641
      train_ef: 18.5,          // g CO2e / t·km, PKP Cargo Raport zintegrowany 2022 s.49
      grid: 0.641,             // kg CO2e/kWh, Lewandowska 2025 Tablo 15 s.20
      LHV_coal: 21.43,         // MJ/kg, KOBiZE ETS 2026 Tablo 1
      EF_coal: 93.89,          // kg CO2/GJ, KOBiZE aynı tablo
      eurpln: 4.4090,          // NBP Tablo A, 28 Eki 2026
      p_coal: 13.77,           // PLN/GJ, ARP/TGE PSCMI1
      p_bio: 27.60,            // PLN/GJ, URE 2025 Tablo 4
      p_el: 446.30,            // PLN/MWh, TGE 2025
    },
  };

  // ---------------------------------------------------------------- teknoloji ve yakıt varsayılanları
  const VARSAYILAN = {
    ulke: "PL",
    GWP_CH4_fos: 29.8, GWP_CH4_bio: 27.0, GWP_N2O: 273.0,   // IPCC AR6 WG1 Tablo 7.15
    coal: { M: 10.0, A: 22.0, C: 54.9, H: 3.5, N: 1.3, S: 0.7 },
    bio_d: { C: 50.46, H: 6.00, N: 0.39, S: 0.05, A: 3.0 },
    M_bio: 45.0, LHV_bio_d: 19.0,
    T_yatak: 875.0, n2o_mod: "sicaklik", n2o_coal_elle: 45.0,
    n2o_bio: 7.0, ch4_coal: 1.0, ch4_bio: 3.0,
    CaS: 2.0, capture: 0.90, purity: 0.964, mgco3: 0.0072, lime_prod: 4.5,
    c_ash: 0.02, q_C: 32.8,
    train_km: 100.0,
    harvest: 1.6, truck_km: 341.0, truck_diesel: 0.040,
    diesel_MJ_L: 3.035 / 0.08203, diesel_EF: 95.1, harv_diesel: 0.0120 + 0.00336,
    dm_rate: 1.5, dm_months: 3.0,
    aux_coal: 12.0, aux_bio: 18.0,
    nh3w: 0.30, nh3_frac: 0.25, nh3_ef: 2.4, sand: 4.0,
    su_coal: 0.0025, su_bio: 0.003, oil_EF: 0.27288 + 0.06291,
    hum: 0.013, O2ref: 6.0,
    ets: 84.49, bio_sertifikali: true,
    // kum ve kireçtaşının tesise taşınması (seçenek; varsayılan kapalı, hesap belgesiyle aynı sayılar için)
    malz_tasima: false, malz_km: 100.0, malz_arac: "kamyon",
    // sarf malzemesi fiyatları, € (arastirma/okuma_notlari/K_sarf_fiyatlari.md)
    p_lime: 45.0,    // €/t teslim kireçtaşı sorbenti; TED 551112-2023 (Termika Żerań CFB sorbenti), TED 793352-2024, 796961-2025
    p_nh3w: 270.0,   // €/t %25 amonyak suyu teslim; TED 71297-2026 (PGE EC, 5 santral) medyanı
    p_sand: 60.0,    // €/t yatak kumu; Rydén vd. 2018 Appl. Sci. 8:2657 s.19 (40–80)
    p_oil: 1000.0,   // €/t ısıtma yağı, vergisiz, 2023–2025 ort.; AB Komisyonu Weekly Oil Bulletin, Polonya
    LHV_oil: 43.0,   // GJ/t gaz/dizel yağı; IPCC 2006 Cilt 2 Tablo 1.2
  };
  // taşıma araçlarının emisyon faktörleri, g CO2e / t·km
  const ARAC_EF = {
    kamyon: 96.3,  // DESNZ 2026, ağır yük kamyonu ortalaması
    tren: 18.5,    // PKP Cargo Raport zintegrowany 2022 s.49
  };
  Object.assign(VARSAYILAN, ULKELER.PL);

  // Częstochowa örnek vakasının kazanları. kap: buhara verilen ısı, MW (Ostrava 8. ve 9. slayt)
  const DH = 144.5 / 57.9; // MJ/kg buhar
  const KAZANLAR = [
    { ad: "Boiler 1 · 70% coal", share_coal: 70, eta: 0.91, kap: 77.2 * DH, saat: 5500, kirectasi: true },
    { ad: "Boiler 2 · 100% chips", share_coal: 0, eta: 0.91, kap: 144.5, saat: 5500, kirectasi: false },
  ];

  function n2oKomurSicakliktan(T) {
    if (T > 900) return 30.0;  // Tsupari 2007 Tablo 6, s.296
    if (T >= 860) return 45.0; // Tsupari 2007 Şekil 4, kazan D
    return 61.0;               // IPCC 2006 Cilt 2 Tablo 2.6
  }

  // Ortak (kazandan bağımsız) türetilmiş değerler
  function ortak(p) {
    const coal = Object.assign({}, p.coal);
    coal.O = 100 - Object.values(p.coal).reduce((a, b) => a + b, 0);
    const bd = Object.assign({}, p.bio_d);
    bd.O = 100 - Object.values(p.bio_d).reduce((a, b) => a + b, 0);
    const M = p.M_bio;
    const LHV_bio = p.LHV_bio_d * (1 - M / 100) - 0.02443 * M; // EN ISO 18125
    const bio = {};
    for (const k in bd) bio[k] = bd[k] * (1 - M / 100);
    bio.M = M;
    const n2oc = p.n2o_mod === "elle" ? p.n2o_coal_elle : n2oKomurSicakliktan(p.T_yatak);
    const tr = p.truck_diesel * p.diesel_MJ_L * p.diesel_EF / (LHV_bio * 1000); // g CO2e / MJ yonga / km
    const L = p.dm_rate * p.dm_months / 100;
    return { coal, bd, bio, LHV_bio, n2oc, tr, L, dm_factor: 1 / (1 - L) - 1 };
  }

  function kazan(p, k) {
    const o = ortak(p);
    const { coal, bio, LHV_bio, n2oc } = o;
    const share_coal = k.share_coal / 100, eta = k.eta;
    const K = { ad: k.ad, share_coal, eta };
    const fuel_MWh = 1 / eta, fuel_GJ = GJ_per_MWh / eta;
    K.fuel_MWh = fuel_MWh; K.fuel_GJ = fuel_GJ;
    const E_coal = fuel_GJ * share_coal, E_bio = fuel_GJ * (1 - share_coal);
    K.E_coal_GJ = E_coal; K.E_bio_GJ = E_bio;
    const m_coal = E_coal / (p.LHV_coal / 1000), m_bio = E_bio / (LHV_bio / 1000);
    K.m_coal = m_coal; K.m_bio = m_bio;
    const el = {};
    for (const e of ["C", "H", "N", "S", "O", "A", "M"]) {
      el[e] = m_coal * (coal[e] || 0) / 100 + m_bio * (bio[e] || 0) / 100;
    }
    K.el = el;
    // ---- kükürt ve kireçtaşı
    const S_coal = m_coal * coal.S / 100;
    let caco3 = 0, S_cap = 0;
    if (k.kirectasi && share_coal > 0) {
      caco3 = p.CaS * S_coal / MW.S * MW.CaCO3;
      S_cap = p.capture * S_coal;
    }
    const lime = caco3 > 0 ? caco3 / p.purity : 0;
    const mg = lime * p.mgco3, inert = lime - caco3 - mg;
    const co2_calc = caco3 * MW.CO2 / MW.CaCO3 + mg * MW.CO2 / MW.MgCO3;
    Object.assign(K, { S_coal, caco3, lime, S_cap, co2_calc });
    // ---- katılar ve yanmamış karbon
    const sand = p.sand * fuel_MWh * (1 - share_coal);
    const nh3w = p.nh3w * fuel_MWh;
    const caO_left = (caco3 / MW.CaCO3 - S_cap / MW.S) * MW.CaO;
    const caso4 = S_cap / MW.S * MW.CaSO4;
    const mgo = mg / MW.MgCO3 * MW.MgO;
    const sol0 = { kul: el.A, CaO: caO_left, CaSO4: caso4, MgO: mgo, inert, kum: sand };
    const sol0Top = Object.values(sol0).reduce((a, b) => a + b, 0);
    const C_unb = Math.min(p.c_ash / (1 - p.c_ash) * sol0Top, el.C);
    const solids = Object.assign({}, sol0, { C: C_unb });
    Object.assign(K, { sand, nh3w, solids, C_unb });
    const C_b = el.C - C_unb;
    // ---- oksijen ihtiyacı
    const nC = C_b / MW.C, nH = el.H / MW.H, nS = el.S / MW.S, nScap = S_cap / MW.S;
    const n_nh3 = nh3w * p.nh3_frac / MW.NH3;
    const O2_need = (nC + nH / 4 + nS + 0.5 * nScap + 0.75 * n_nh3) * MW.O2 - el.O;
    const air_min = O2_need / 0.2314;
    // ---- λ: kuru baca gazında O2 tam O2ref olacak şekilde
    const n_CO2 = nC + co2_calc / MW.CO2;
    const n_SO2 = nS - nScap;
    const n_fix = n_CO2 + n_SO2 + el.N / MW.N2 + 0.5 * n_nh3;
    const a = O2_need * (1 - 0.2314) / (0.2314 * MW.N2);
    const b = O2_need / MW.O2;
    const x = p.O2ref / 100;
    const lam = (x * n_fix + b * (1 - x)) / (b * (1 - x) - x * a);
    K.lambda_ = lam;
    const air = lam * air_min, hum = p.hum * air;
    K.air = air; K.hum = hum;
    // ---- baca gazı (kg)
    const g = {};
    g.CO2 = C_b * MW.CO2 / MW.C + co2_calc;
    g.H2O = el.H * MW.H2O / (2 * MW.H) + el.M + hum + nh3w * (1 - p.nh3_frac) + 1.5 * n_nh3 * MW.H2O;
    g.SO2 = n_SO2 * MW.SO2;
    g.O2 = (lam - 1) * O2_need;
    g.N2 = air * (1 - 0.2314) + el.N + n_nh3 * MW.N;
    K.gas = g;
    K.gas_total = Object.values(g).reduce((s, v) => s + v, 0);
    K.inputs = { komur: m_coal, yonga: m_bio, hava: air, nem: hum, kirectasi: lime, kum: sand, amonyak: nh3w };
    K.m_in = Object.values(K.inputs).reduce((s, v) => s + v, 0);
    K.m_out = K.gas_total + Object.values(solids).reduce((s, v) => s + v, 0);
    K.m_diff = K.m_in - K.m_out;
    const n_dry = g.CO2 / MW.CO2 + g.SO2 / MW.SO2 + g.O2 / MW.O2 + g.N2 / MW.N2;
    K.V_dry = n_dry * 22.414;
    K.O2_dry_check = g.O2 / MW.O2 / n_dry * 100;
    K.SO2_mg = g.SO2 * 1e6 / K.V_dry;
    // ---- emisyonlar (kg CO2e / MWh buhar)
    const em = {};
    em.coal_co2 = E_coal * p.EF_coal;
    K.co2_bio = m_bio * bio.C / 100 * MW.CO2 / MW.C;
    const n2o = (n2oc * E_coal + p.n2o_bio * E_bio) / 1000;
    K.n2o_kg = n2o;
    em.n2o = n2o * p.GWP_N2O;
    em.ch4 = (p.ch4_coal * E_coal * p.GWP_CH4_fos + p.ch4_bio * E_bio * p.GWP_CH4_bio) / 1000;
    em.calc = co2_calc;
    em.mine_ch4 = m_coal / 1000 * p.mine_ch4 * p.GWP_CH4_fos;
    em.mining_co2 = E_coal * p.mining_co2;
    em.train = m_coal / 1000 * p.train_km * p.train_ef / 1000;
    em.harvest = E_bio * p.harvest;
    em.truck = E_bio * o.tr * p.truck_km;
    em.dm_loss = (em.harvest + em.truck) * o.dm_factor;
    K.aux_kWh = (p.aux_coal * share_coal + p.aux_bio * (1 - share_coal)) * fuel_MWh;
    em.aux = K.aux_kWh * p.grid;
    em.nh3 = nh3w * p.nh3_frac * p.nh3_ef;
    em.sand_lime = (sand + lime) * p.lime_prod / 1000;
    em.malz_tasima = p.malz_tasima ? (sand + lime) / 1000 * p.malz_km * ARAC_EF[p.malz_arac] / 1000 : 0;
    const su = (p.su_coal * share_coal + p.su_bio * (1 - share_coal)) * fuel_GJ;
    em.startup = su / 0.0036 * p.oil_EF;
    K.oil_kg = su / p.LHV_oil * 1000;
    K.em = em;
    K.toplam = Object.values(em).reduce((s, v) => s + v, 0);
    K.fosil_baca = em.coal_co2 + em.calc;
    K.dm_lost_GJ = E_bio * o.dm_factor;
    // ---- maliyet (€/MWh buhar)
    const c = {};
    c.komur = E_coal * p.p_coal / p.eurpln;
    c.yonga = E_bio * p.p_bio / p.eurpln;
    c.yonga_kayip = K.dm_lost_GJ * p.p_bio / p.eurpln;
    c.ets = (K.fosil_baca + (p.bio_sertifikali ? 0 : K.co2_bio)) / 1000 * p.ets;
    c.elektrik = K.aux_kWh / 1000 * p.p_el / p.eurpln;
    c.sarf = (lime * p.p_lime + nh3w * p.p_nh3w + sand * p.p_sand + K.oil_kg * p.p_oil) / 1000;
    K.cost = c;
    K.cost_top = Object.values(c).reduce((s, v) => s + v, 0);
    // ---- yıllık
    K.buhar_GWh = k.kap * k.saat / 1000;
    K.yil_t = K.buhar_GWh * K.toplam;            // GWh × kg/MWh = t
    K.yil_Meur = K.cost_top * K.buhar_GWh / 1000; // €/MWh × GWh = k€ → M€
    K.yonga_t_yil = K.buhar_GWh * m_bio / (1 - o.L);
    K.komur_t_yil = K.buhar_GWh * m_coal;
    return K;
  }

  function hesapla(p, kazanlar) {
    const o = ortak(p);
    return { ortak: o, kazanlar: kazanlar.map(k => kazan(p, k)) };
  }

  const api = { MW, ULKELER, VARSAYILAN, KAZANLAR, ARAC_EF, n2oKomurSicakliktan, hesapla };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Model = api;
})(this);
