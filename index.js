/**
 * BARBERAPP - SISTEMA DE GESTÃO PARA BARBEARIAS
 * Arquivo: index.js
 * Desenvolvido por Antigravity (Google DeepMind)
 */

// 1. CONFIGURAÇÕES E CREDENCIAIS (PLATAFORMA SaaS)
// ==========================================
// ESTAS SÃO AS CHAVES DA SUA PLATAFORMA (Onde os usuários fazem o login inicial)
const SAAS_MASTER_URL = "SUA_URL_MASTER_AQUI"; // Ex: https://xxx.supabase.co
const SAAS_MASTER_KEY = "SUA_KEY_MASTER_AQUI"; // Ex: eyJhbGciOiJIUzI1Ni...

let supabaseClient = null;

function getSupabase() {
  // Prioriza o banco de dados configurado pelo usuário, caso contrário usa o Master para Auth
  const url = state.supabaseUrl || SAAS_MASTER_URL;
  const key = state.supabaseKey || SAAS_MASTER_KEY;

  if (!supabaseClient || supabaseClient.supabaseUrl !== url) {
    try {
      if (url && key && url !== "SUA_URL_MASTER_AQUI") {
        supabaseClient = window.supabase.createClient(url, key);
      }
    } catch (e) {
      console.error("Erro ao inicializar Supabase:", e);
    }
  }
  return supabaseClient;
}

// ==========================================
// 2. ESTADO GLOBAL DA APLICAÇÃO (Single Source of Truth)
// ==========================================
const state = {
  currentPage: "dashboard",
  isIntegrated: localStorage.getItem("isIntegrated") === "true",
  syncStatus: "idle",
  searchTerm: "",
  supabaseUrl: localStorage.getItem("supabaseUrl") || "",
  supabaseKey: localStorage.getItem("supabaseKey") || "",
  isValidating: false,
  showGuide: false,
  clientView: "clients", // 'clients' ou 'procedures'
  barbers: [],
  records: [],
  clients: [], // Nova base de clientes
  filters: {
    day: new Date().getDate(),
    month: new Date().getMonth() + 1,
    year: new Date().getFullYear(),
  },
  kpis: {
    diario: "R$ 0,00",
    mensal: "R$ 0,00",
    anual: "R$ 0,00",
  },
  charts: {},
  theme: {
    accent: localStorage.getItem("themeAccent") || "#F59E0B",
    accentRgb: localStorage.getItem("themeAccentRgb") || "245 158 11",
  },
  profitFilter: "diario",
  editingRecord: null,
  editingClient: null,
  editingProcedure: null,
  clientView: "clients", // 'clients' ou 'procedures'
  procedures: [],
  clientSearch: "",
  isClientDropdownOpen: false,
  showEmptySlots: true,
  managementSearch: "",
  user: null,
};

// ==========================================
// 3. FUNÇÕES AUXILIARES (Helpers & UI)
// ==========================================

/**
 * Converte Hex para RGB para uso nas variáveis CSS
 */
function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result
    ? `${parseInt(result[1], 16)} ${parseInt(result[2], 16)} ${parseInt(
        result[3],
        16
      )}`
    : "245 158 11";
}

/**
 * Aplica o tema atual no documento
 */
function applyTheme() {
  document.documentElement.style.setProperty(
    "--accent-rgb",
    state.theme.accentRgb
  );
  localStorage.setItem("themeAccent", state.theme.accent);
  localStorage.setItem("themeAccentRgb", state.theme.accentRgb);
}

// ==========================================
// 4. COMUNICAÇÃO COM API (Supabase)
// ==========================================
/**
 * Busca clientes cadastrados no Supabase
 */
async function fetchClients() {
  if (!state.supabaseUrl || !state.supabaseKey) return;

  try {
    const res = await fetch(
      `${state.supabaseUrl}/rest/v1/clientes?select=*&order=nome.asc`,
      {
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
        },
      }
    );
    if (res.ok) {
      state.clients = await res.json();
      render();
    }
  } catch (err) {
    console.error("Erro ao buscar clientes:", err);
  }
}

/**
 * Busca procedimentos cadastrados no Supabase
 */
async function fetchProcedures() {
  if (!state.supabaseUrl || !state.supabaseKey) return;

  try {
    const res = await fetch(
      `${state.supabaseUrl}/rest/v1/procedimentos?select=*&order=nome.asc`,
      {
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
        },
      }
    );
    if (res.ok) {
      state.procedures = await res.json();
      render();
    }
  } catch (err) {
    console.error("Erro ao buscar procedimentos:", err);
  }
}

/**
 * Busca todos os agendamentos diretamente do Supabase
 */
async function fetchAgendamentos() {
  if (!state.supabaseUrl || !state.supabaseKey) return false;

  try {
    state.syncStatus = "syncing";
    const res = await fetch(`${state.supabaseUrl}/rest/v1/agendamentos?select=*`, {
      headers: {
        apikey: state.supabaseKey,
        Authorization: "Bearer " + state.supabaseKey,
      },
    });

    if (res.ok) {
      const data = await res.json();
      state.records = data.map((r) => ({
        id: r.id,
        date: r.data,
        time: r.horario,
        client: r.cliente,
        service: r.procedimento || "A DEFINIR",
        value: parseFloat(r.valor) || 0,
        paymentMethod: r.forma_pagamento || "N/A",
      })).sort((a, b) => new Date(a.date + "T" + a.time) - new Date(b.date + "T" + b.time));

      state.isIntegrated = true;
      localStorage.setItem("isIntegrated", "true");
      updateInternalStats();
      state.syncStatus = "idle";
      render();
      return true;
    }
    return false;
  } catch (err) {
    console.error("Erro ao buscar agendamentos:", err);
    state.syncStatus = "error";
    return false;
  }
}

function updateInternalStats() {
  if (state.records.length === 0) return;

  // Filtro baseado na seleção do usuário
  const targetDay = state.filters.day;
  const targetMonth = String(state.filters.month).padStart(2, "0");
  const targetYear = String(state.filters.year);
  const monthPrefix = `${targetYear}-${targetMonth}`;
  const dayPrefix = `${monthPrefix}-${String(targetDay).padStart(2, "0")}`;

  const calcTotal = (filterFn) =>
    state.records.filter(filterFn).reduce((acc, r) => acc + r.value, 0);

  // Diário: Se 'Todos' (0) estiver selecionado, mostra o dia atual real, senão mostra o dia filtrado
  const displayDay =
    targetDay === 0 ? new Date().toISOString().split("T")[0] : dayPrefix;

  const daily = calcTotal((r) => r.date === displayDay);
  const monthly = calcTotal((r) => r.date.startsWith(monthPrefix));
  const annual = calcTotal((r) => r.date.startsWith(targetYear));

  state.kpis.diario = `R$ ${daily.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  })}`;
  state.kpis.mensal = `R$ ${monthly.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  })}`;
  state.kpis.anual = `R$ ${annual.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
  })}`;

  state.barbers = [
    { name: "Faturamento Período", revenue: monthly, score: 100 },
  ];
}

// ==========================================
// 5. ROTEAMENTO E NAVEGAÇÃO
// ==========================================

/**
 * Altera a página atual e re-renderiza a UI
 * @param {string} page - Nome da página (dashboard, records, manage, etc)
 */
function navigate(page, time = null) {
  state.currentPage = page;
  state.clientSearch = ""; // Limpa a busca ao navegar
  state.isClientDropdownOpen = false;

  // Se estiver navegando para agendar e tiver um horário, inicializa o estado
  if (page === "manage") {
    if (!state.editingRecord) {
      state.editingRecord = {
        horario: time || "",
        data: `${state.filters.year}-${String(state.filters.month).padStart(
          2,
          "0"
        )}-${String(state.filters.day).padStart(2, "0")}`,
      };
    }
  } else {
    state.editingRecord = null;
  }

  render();
}
// ==========================================
// 6. COMPONENTES DE INTERFACE (UI)
// ==========================================

const Sidebar = () => `
    <aside class="hidden md:flex w-64 bg-dark-900 border-r border-white/5 flex flex-col h-full transition-all duration-300">
        <div class="p-6 overflow-hidden">
            <h1 class="text-xl font-display font-extrabold text-amber-500 tracking-tighter italic whitespace-nowrap">
                PAINEL <span class="text-white"> DE GESTÃO</span>
            </h1>
        </div>
        <nav class="flex-1 px-4 space-y-2 mt-4">
            <!-- Itens do Menu Lateral -->
            ${NavLink("dashboard", "fa-chart-line", "Dashboard")}
            ${NavLink("records", "fa-table", "Agendamentos")}
            ${NavLink("manage", "fa-calendar-plus", "Agendar")}
            ${NavLink("clients", "fa-sliders", "Gestão")}
            ${NavLink("setup", "fa-gears", "Configuração")}
        </nav>
        <div class="p-4 border-t border-white/5">
            <div class="flex items-center space-x-3 p-2 rounded-xl bg-dark-950/50">
                <div class="w-10 h-10 rounded-full border border-white/10 overflow-hidden bg-dark-900 shadow-lg shadow-black/20">
                    <img src="assets/logo.png" class="w-full h-full object-cover" onerror="this.src='https://ui-avatars.com/api/?name=Admin&background=F59E0B&color=000'">
                </div>
                <div class="flex-1 min-w-0">
                    <!-- Nome do Barbeiro/Perfil -->
                    <p class="text-sm font-semibold truncate text-white uppercase">Administrador</p>
                    <!-- Label de Status da Conta -->
                    <p class="text-[10px] text-amber-500 font-bold uppercase tracking-widest">SaaS Edition</p>
                </div>
            </div>
        </div>
    </aside>
`;

const NavLink = (page, icon, label) => {
  const isActive = state.currentPage === page;
  return `
        <button onclick="window.navigate('${page}')" 
                class="flex items-center w-full px-4 py-3 rounded-xl transition-all duration-200 group border border-transparent
                ${
                  isActive
                    ? "bg-amber-500 text-dark-950 shadow-lg shadow-amber-500/20"
                    : "text-slate-400 hover:bg-white/5 hover:text-white"
                }">
            <i class="fas ${icon} w-6 text-lg ${
    isActive ? "" : "group-hover:text-amber-500"
  }"></i>
            <span class="ml-3 font-semibold">${label}</span>
        </button>
    `;
};

const MobileNav = () => `
    <nav class="md:hidden fixed bottom-0 left-0 right-0 bg-dark-900/90 backdrop-blur-xl border-t border-white/5 px-6 py-3 flex justify-between items-center z-50">
        ${MobileNavLink("dashboard", "fa-chart-line", "Início")}
        ${MobileNavLink("records", "fa-table", "Lista")}
        ${MobileNavLink("manage", "fa-calendar-plus", "Agendar")}
        ${MobileNavLink("clients", "fa-sliders", "Gestão")}
        ${MobileNavLink("setup", "fa-gears", "Ajustes")}
    </nav>
`;

const MobileNavLink = (page, icon, label) => {
  const isActive = state.currentPage === page;
  return `
        <button onclick="window.navigate('${page}')" 
                class="flex flex-col items-center space-y-1 transition-all
                ${isActive ? "text-amber-500" : "text-slate-500"}">
            <i class="fas ${icon} text-lg"></i>
            <!-- Label do Menu Mobile -->
            <span class="text-[9px] font-black uppercase tracking-tighter">${label}</span>
        </button>
    `;
};

const Header = () => {
  window.updateFilter = (type, val) => {
    state.filters[type] = parseInt(val);
    updateInternalStats();
    render();
  };

  window.syncAll = async () => {
    const btn = document.getElementById("globalSyncBtn");
    if (btn) btn.classList.add("fa-spin");

    await Promise.all([
      fetchAgendamentos(),
      fetchClients(),
      fetchProcedures(),
    ]);

    if (btn) btn.classList.remove("fa-spin");
  };

  const months = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const days = Array.from({ length: 31 }, (_, i) => i + 1);

  const today = new Date();
  const formattedDate = new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(today);

  const user = state.user;
  const userAvatar = user?.user_metadata?.avatar_url || `https://ui-avatars.com/api/?name=${encodeURIComponent(user?.email || 'U')}&background=F59E0B&color=fff`;

  return `
        <header class="h-16 md:h-16 border-b border-white/5 flex items-center justify-between px-3 md:px-8 bg-dark-950/80 backdrop-blur-xl sticky top-0 z-20">
            <div class="flex items-center space-x-1.5 md:space-x-4">
                <!-- Filtro de Dia -->
                <select onchange="window.updateFilter('day', this.value)" class="bg-dark-900 border border-white/10 text-[10px] md:text-xs font-bold rounded-lg px-2 md:px-3 py-1.5 outline-none focus:border-amber-500 w-14 md:w-auto">
                    ${days
                      .map(
                        (d) =>
                          `<option value="${d}" ${
                            state.filters.day === d ? "selected" : ""
                          }>${String(d).padStart(2, "0")}</option>`
                      )
                      .join("")}
                </select>
                <!-- Filtro de Mês -->
                <select onchange="window.updateFilter('month', this.value)" class="bg-dark-900 border border-white/10 text-[10px] md:text-xs font-bold rounded-lg px-1.5 md:px-3 py-1.5 outline-none focus:border-amber-500 w-16 md:w-auto">
                    ${months
                      .map(
                        (m, i) =>
                          `<option value="${i + 1}" ${
                            state.filters.month === i + 1 ? "selected" : ""
                          }>${m.substring(0, 3).toUpperCase()}</option>`
                      )
                      .join("")}
                </select>
            </div>

            <div class="flex items-center space-x-2 md:space-x-4">
                <div class="hidden lg:flex items-center space-x-2 text-xs text-slate-400 mr-4">
                    <i class="fas fa-calendar"></i>
                    <span class="font-medium">${formattedDate}</span>
                </div>
                
                <div class="flex items-center bg-dark-900 border border-white/5 p-1 rounded-xl pr-3 gap-3">
                    <img src="${userAvatar}" class="w-8 h-8 rounded-lg object-cover border border-white/10 shadow-lg">
                    <div class="hidden sm:block text-left">
                        <p class="text-[10px] font-black text-white leading-none uppercase tracking-tighter truncate max-w-[100px]">${user?.user_metadata?.full_name || 'Barbeiro'}</p>
                        <p class="text-[8px] text-amber-500 font-bold uppercase tracking-widest mt-0.5">Premium</p>
                    </div>
                    <button onclick="window.signOut()" class="w-6 h-6 flex items-center justify-center text-slate-500 hover:text-rose-500 transition-all ml-1">
                        <i class="fas fa-power-off text-xs"></i>
                    </button>
                </div>

                <button onclick="window.syncAll()" class="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-white/5 hover:bg-amber-500/10 hover:text-amber-500 transition-all flex items-center justify-center border border-white/5 uppercase">
                    <i id="globalSyncBtn" class="fas fa-sync-alt text-xs md:text-sm"></i>
                </button>
            </div>
        </header>
    `;
};

const Dashboard = () => {
  if (!state.isIntegrated) {
    return `
            <div class="p-8 h-full flex items-center justify-center">
                <div class="text-center space-y-4">
                    <i class="fas fa-database text-6xl text-white/5 mb-4"></i>
                    <h2 class="text-2xl font-bold">Nenhum dado conectado</h2>
                    <button onclick="navigate('setup')" class="bg-amber-500 text-dark-950 px-6 py-2 rounded-xl font-bold border border-transparent transition-all">Configurar Agora</button>
                </div>
            </div>
        `;
  }

  window.renderCharts = () => {
    if (state.charts.profit) state.charts.profit.destroy();

    const targetDay = parseInt(state.filters.day);
    const targetMonth = String(state.filters.month).padStart(2, "0");
    const targetYear = String(state.filters.year);
    const monthPrefix = `${targetYear}-${targetMonth}`;
    const dayPrefix = `${monthPrefix}-${String(targetDay).padStart(2, "0")}`;

    // --- Gráfico de Lucro com Filtro Próprio ---
    let profitRecords = [];
    let groupKeyFn;
    let labelFn = (k) => k;

    if (state.profitFilter === "diario") {
      profitRecords = state.records.filter(
        (r) =>
          r.date ===
          (targetDay === 0 ? new Date().toISOString().split("T")[0] : dayPrefix)
      );
      groupKeyFn = (r) => r.time.split(":")[0] + ":00";
    } else if (state.profitFilter === "mensal") {
      profitRecords = state.records.filter((r) =>
        r.date.startsWith(monthPrefix)
      );
      groupKeyFn = (r) => r.date.split("-")[2];
      labelFn = (k) => `Dia ${k}`;
    } else if (state.profitFilter === "anual") {
      profitRecords = state.records.filter((r) =>
        r.date.startsWith(targetYear)
      );
      groupKeyFn = (r) => r.date.split("-")[1];
      const monthNames = [
        "Jan",
        "Fev",
        "Mar",
        "Abr",
        "Mai",
        "Jun",
        "Jul",
        "Ago",
        "Set",
        "Out",
        "Nov",
        "Dez",
      ];
      labelFn = (k) => monthNames[parseInt(k) - 1];
    } else {
      // total
      profitRecords = state.records;
      groupKeyFn = (r) => r.date.split("-")[0];
    }

    const profitStats = profitRecords.reduce((acc, r) => {
      const key = groupKeyFn(r);
      acc[key] = (acc[key] || 0) + r.value;
      return acc;
    }, {});

    const sortedKeys = Object.keys(profitStats).sort();

    const ctx2 = document.getElementById("profitChart")?.getContext("2d");
    if (ctx2) {
      state.charts.profit = new Chart(ctx2, {
        type: "line",
        data: {
          labels: sortedKeys.map(labelFn),
          datasets: [
            {
              label: "Faturamento R$",
              data: sortedKeys.map((k) => profitStats[k]),
              borderColor: state.theme.accent,
              backgroundColor: `rgba(${state.theme.accentRgb}, 0.1)`,
              fill: true,
              tension: 0.4,
              borderWidth: 3,
              pointRadius: 4,
              pointBackgroundColor: state.theme.accent,
            },
          ],
        },
        options: {
          maintainAspectRatio: false,
          plugins: { legend: { display: false } },
          scales: {
            y: {
              grid: { color: "rgba(255,255,255,0.03)" },
              ticks: { color: "#64748b", font: { size: 10 } },
            },
            x: {
              grid: { display: false },
              ticks: { color: "#64748b", font: { size: 10 } },
            },
          },
        },
      });
    }
  };

  window.updateProfitFilter = (val) => {
    state.profitFilter = val;
    render();
  };

  setTimeout(() => window.renderCharts(), 0);

  return `
        <div class="p-4 sm:p-8 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div class="flex justify-between items-end">
                <div>
                    <!-- Título Principal Dashboard -->
                    <h2 class="text-2xl sm:text-3xl font-display font-bold text-white uppercase">MEU NEGÓCIO <span class="text-amber-500">DASHBOARD</span></h2>
                    <!-- Subtítulo ou Descrição -->
                    <p class="text-slate-500 text-xs sm:text-sm mt-1">Gestão financeira e performance estratégica</p>
                </div>
            </div>

            <!-- KPIs -->
            <div class="grid grid-cols-1 md:grid-cols-3 gap-6">
                ${KPICard(
                  "Faturamento do Dia",
                  state.kpis.diario,
                  "fa-calendar-day"
                )}
                ${KPICard(
                  "Faturamento do Mês",
                  state.kpis.mensal,
                  "fa-calendar-days"
                )}
                ${KPICard(
                  "Faturamento do Ano",
                  state.kpis.anual,
                  "fa-calendar-check"
                )}
            </div>

            <!-- Chart -->
            <div class="grid grid-cols-1 gap-6 sm:gap-8 pb-8">
                <div class="glass-card p-6 sm:p-8 rounded-[2rem] h-[400px] sm:h-[450px] flex flex-col">
                    <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6 sm:mb-8">
                        <h3 class="text-lg font-bold">Lucro Bruto</h3>
                        <div class="flex bg-dark-950 p-1 rounded-xl border border-white/5 space-x-1 overflow-x-auto max-w-full no-scrollbar">
                            ${["diario", "mensal", "anual", "total"]
                              .map(
                                (f) => `
                                <button onclick="window.updateProfitFilter('${f}')" 
                                        class="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all
                                        ${
                                          state.profitFilter === f
                                            ? "bg-amber-500 text-dark-950 shadow-lg shadow-amber-500/20"
                                            : "text-slate-500 hover:text-white"
                                        }">
                                    ${f}
                                </button>
                            `
                              )
                              .join("")}
                        </div>
                    </div>
                    <div class="flex-1 min-h-0"><canvas id="profitChart"></canvas></div>
                </div>
            </div>
        </div>
    `;
};

const KPICard = (title, value, icon) => `
    <div class="glass-card p-5 sm:p-7 rounded-[2rem] group hover:border-amber-500/30 transition-all duration-500 relative overflow-hidden">
        <div class="absolute -right-4 -top-4 w-24 h-24 bg-amber-500/5 rounded-full blur-2xl group-hover:bg-amber-500/10 transition-all"></div>
        <div class="flex justify-between items-start mb-4 sm:mb-6">
            <div class="w-12 h-12 sm:w-14 sm:h-14 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                <i class="fas ${icon} text-xl sm:text-2xl"></i>
            </div>
        </div>
        <p class="text-slate-500 text-[10px] sm:text-xs font-bold uppercase tracking-widest">${title}</p>
        <h2 class="text-2xl sm:text-4xl font-display font-extrabold mt-1 sm:mt-2 tracking-tight">${value}</h2>
    </div>
`;
// ==========================================
// 7. PÁGINAS DA APLICAÇÃO
// ==========================================

/**
 * PÁGINA: Histórico de Agendamentos (Tabela/Planilha)
 */
const RecordsPage = () => {
  if (!state.isIntegrated) {
    return `
            <div class="p-8 h-full flex items-center justify-center">
                <div class="text-center space-y-4">
                    <i class="fas fa-table text-6xl text-white/5 mb-4"></i>
                    <h2 class="text-2xl font-bold">Sem dados sincronizados</h2>
                    <button onclick="navigate('setup')" class="bg-amber-500 text-dark-950 px-6 py-2 rounded-xl font-bold border border-transparent transition-all hover:bg-amber-400">Configurar Supabase</button>
                </div>
            </div>
        `;
  }

  const targetDay = parseInt(state.filters.day);
  const targetMonth = String(state.filters.month).padStart(2, "0");
  const targetYear = String(state.filters.year);
  const monthPrefix = `${targetYear}-${targetMonth}`;
  const dayPrefix = `${monthPrefix}-${String(targetDay).padStart(2, "0")}`;

  // Lista de horários padrão para visualização em "planilha"
  const standardTimes = [];
  let currentMinutes = 7 * 60 + 20; // 07:20 em minutos
  const endMinutes = 22 * 60; // 22:00 em minutos

  while (currentMinutes <= endMinutes) {
    const h = Math.floor(currentMinutes / 60);
    const m = currentMinutes % 60;
    standardTimes.push(
      `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`
    );
    currentMinutes += 40; // Intervalo de 40 minutos
  }

  let recordsToDisplay = [];

  if (targetDay === 0) {
    // Se for "Mês Inteiro", mostramos apenas o que existe (comportamento original)
    recordsToDisplay = state.records
      .filter((r) => r.date.startsWith(monthPrefix))
      .filter(
        (r) =>
          r.client.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
          r.service.toLowerCase().includes(state.searchTerm.toLowerCase())
      );
  } else {
    // Se for um dia específico, usamos a lógica de planilha
    const existingForDay = state.records.filter((r) => r.date === dayPrefix);

    // Se houver busca, filtramos apenas os existentes
    if (state.searchTerm) {
      recordsToDisplay = existingForDay.filter(
        (r) =>
          r.client.toLowerCase().includes(state.searchTerm.toLowerCase()) ||
          r.service.toLowerCase().includes(state.searchTerm.toLowerCase())
      );
    } else {
      // Criamos um set de IDs já exibidos para não duplicar
      const displayedIds = new Set();
      recordsToDisplay = [];

      // Primeiro, iteramos pelos horários padrão
      standardTimes.forEach((time) => {
        const matches = existingForDay.filter((r) =>
          r.time.startsWith(time.substring(0, 5))
        );
        if (matches.length > 0) {
          matches.forEach((m) => {
            recordsToDisplay.push(m);
            displayedIds.add(m.id);
          });
        } else {
          recordsToDisplay.push({
            time,
            client: "---",
            service: "---",
            value: 0,
            paymentMethod: "---",
            isEmpty: true,
          });
        }
      });

      // Depois, adicionamos qualquer registro que sobrou (horários fora do padrão)
      existingForDay.forEach((r) => {
        if (!displayedIds.has(r.id)) {
          recordsToDisplay.push(r);
        }
      });

      // Ordena por horário final
      recordsToDisplay.sort((a, b) => a.time.localeCompare(b.time));

      // Filtra espaços vazios se o usuário desejar
      if (!state.showEmptySlots) {
        recordsToDisplay = recordsToDisplay.filter((r) => !r.isEmpty);
      }
    }
  }

  window.editAppointment = (id) => {
    const record = state.records.find((r) => r.id === id);
    if (record) {
      state.editingRecord = record;
      state.currentPage = "manage";
      render();
    }
  };

  window.cancelAppointment = async (id) => {
    if (
      !confirm(
        "Deseja realmente cancelar este agendamento? Esta ação não pode ser desfeita."
      )
    )
      return;

    try {
      const res = await fetch(
        `${state.supabaseUrl}/rest/v1/agendamentos?id=eq.${id}`,
        {
          method: "DELETE",
          headers: {
            apikey: state.supabaseKey,
            Authorization: "Bearer " + state.supabaseKey,
          },
        }
      );

      if (res.ok) {
        fetchAgendamentos(); // Recarrega os dados
      } else {
        alert("❌ Erro ao cancelar agendamento.");
      }
    } catch (err) {
      alert("❌ Erro de conexão.");
    }
  };

  window.handleSearch = (e) => {
    state.searchTerm = e.value;
    render(); // Re-renderiza para aplicar a lógica de planilha/lista
  };

  window.toggleEmptySlots = () => {
    state.showEmptySlots = !state.showEmptySlots;
    render();
  };

  return `
        <div class="p-4 sm:p-8 space-y-6 sm:space-y-8 animate-in fade-in duration-500">
             <div class="flex flex-col sm:flex-row justify-between items-start sm:items-end gap-4">
                <div>
                    <h2 class="text-2xl sm:text-3xl font-display font-bold">Histórico de Agendamentos</h2>
                    <p class="text-slate-500 text-xs sm:text-sm mt-1">Sincronização via Google Sheets</p>
                </div>
                <div class="relative w-full sm:w-auto flex flex-col sm:flex-row gap-2">
                    <button onclick="window.toggleEmptySlots()" 
                            class="flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-white/5 bg-dark-900/50 hover:bg-amber-500/10 transition-all text-[10px] font-black uppercase tracking-widest ${
                              state.showEmptySlots
                                ? "text-amber-500"
                                : "text-slate-500"
                            }">
                        <i class="fas ${
                          state.showEmptySlots ? "fa-eye-slash" : "fa-eye"
                        }"></i>
                        ${
                          state.showEmptySlots
                            ? "Ocultar Vazios"
                            : "Mostrar Vazios"
                        }
                    </button>
                    <div class="relative flex-1 sm:w-80">
                        <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                        <input type="text" 
                               id="recordsSearchInput"
                               placeholder="Buscar agendamento..." 
                               oninput="window.handleSearch(this)"
                               value="${state.searchTerm}"
                               class="bg-dark-900 border border-white/5 py-2.5 pl-11 pr-4 rounded-xl text-sm outline-none focus:border-amber-500/50 w-full transition-all font-medium">
                    </div>
                </div>
            </div>

            <!-- Tabela via Flexbox -->
            <div class="space-y-4 md:space-y-0 md:bg-dark-900/30 md:rounded-[2rem] border border-white/5 overflow-hidden">
                <!-- Header (Apenas Desktop) -->
                <div class="hidden md:flex bg-white/[0.02] border-b border-white/5 px-8 py-5 text-[10px] font-bold text-slate-500 uppercase tracking-widest text-center">
                    <div class="w-20 text-left">Horário</div>
                    <div class="flex-1 text-left px-4">Cliente</div>
                    <div class="flex-1 text-left px-4">Procedimentos</div>
                    <div class="w-28">Valor</div>
                    <div class="w-32">Pagamento</div>
                    <div class="w-24 text-right">Ações</div>
                </div>

                <div id="tableBody" class="divide-y divide-white/5">
                    ${recordsToDisplay.map((r) => RecordRow(r)).join("")}
                </div>
            </div>
        </div>
    `;
};

const RecordRow = (record) => {
  const isEmpty = !!record.isEmpty;
  const isDayZero = state.filters.day === 0;

  return `
        <div class="flex flex-col md:flex-row items-center md:items-center px-6 md:px-8 py-4 md:py-4 gap-4 md:gap-0 hover:bg-white/[0.01] transition-colors group relative md:static glass-card md:bg-transparent rounded-2xl md:rounded-none m-2 md:m-0 border md:border-0 border-white/5 ${
          isEmpty ? "opacity-40" : ""
        }">
            <div class="w-full md:w-20 text-xs md:text-sm ${
              isEmpty ? "text-slate-500" : "text-amber-500 md:text-slate-400"
            } font-black md:font-medium flex justify-between md:block">
                <span class="md:hidden text-slate-500 font-bold uppercase text-[10px]">Horário:</span>
                ${record.time.substring(0, 5)}
            </div>
            
            <div class="w-full md:flex-1 md:px-4 text-sm md:text-sm font-bold md:font-semibold flex justify-between md:block">
                <span class="md:hidden text-slate-500 font-bold uppercase text-[10px]">Cliente:</span>
                <div class="truncate transition-colors ${
                  !isEmpty
                    ? "group-hover:text-amber-500 uppercase"
                    : "text-slate-600 uppercase"
                }">${record.client}</div>
            </div>

            <div class="w-full md:flex-1 md:px-4 text-xs md:text-sm flex justify-between md:block">
                <span class="md:hidden text-slate-500 font-bold uppercase text-[10px]">Serviço:</span>
                <div class="truncate ${
                  isEmpty
                    ? "text-slate-600"
                    : record.service === "A DEFINIR"
                    ? "text-red-500 font-black animate-pulse"
                    : "text-white font-medium"
                } uppercase">${record.service}</div>
            </div>

            <div class="w-full md:w-28 text-sm md:text-sm font-bold md:font-bold ${
              isEmpty ? "text-slate-600" : "text-white md:text-amber-500/90"
            } flex justify-between md:block md:text-center">
                <span class="md:hidden text-slate-500 font-bold uppercase text-[10px]">Valor:</span>
                ${isEmpty ? "---" : `R$ ${record.value.toFixed(2)}`}
            </div>

            <div class="w-full md:w-32 flex justify-between md:justify-center items-center">
                <span class="md:hidden text-slate-500 font-bold uppercase text-[10px]">Pagamento:</span>
                <span class="px-2 py-0.5 rounded-lg text-[10px] font-black border border-white/5 bg-white/[0.03] text-slate-500 uppercase tracking-tighter ${
                  isEmpty ? "opacity-30" : ""
                }">
                    ${record.paymentMethod.toUpperCase()}
                </span>
            </div>

            <div class="w-full md:w-24 flex justify-end gap-2 pt-4 md:pt-0 border-t md:border-0 border-white/5">
                ${
                  !isEmpty
                    ? `
                    <button onclick="window.editAppointment('${record.id}')" 
                            class="w-9 h-9 md:w-8 md:h-8 rounded-xl bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all transform active:scale-95 shadow-sm flex items-center justify-center">
                        <i class="fas fa-edit text-xs"></i>
                    </button>
                    <button onclick="window.cancelAppointment('${record.id}')" 
                            class="w-9 h-9 md:w-8 md:h-8 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all transform active:scale-95 shadow-sm flex items-center justify-center">
                        <i class="fas fa-trash-can text-xs"></i>
                    </button>
                `
                    : `
                    <button onclick="window.navigate('manage', '${record.time}')" 
                            class="w-full md:w-auto px-4 py-2 md:py-1 rounded-lg bg-white/5 text-slate-500 hover:bg-amber-500/10 hover:text-amber-500 text-[10px] font-bold uppercase transition-all">
                        Agendar
                    </button>
                `
                }
            </div>
        </div>
    `;
};

/**
 * PÁGINA: Gerenciar Agendamento (Novo ou Editar)
 */
const ManagePage = () => {
  if (!state.isIntegrated) return SetupPage();

  const isEditing = !!state.editingRecord;

  // Inicializa a busca se estiver editando
  if (isEditing && !state.clientSearch) {
    state.clientSearch =
      state.editingRecord.client || state.editingRecord.cliente;
  }

  // --- Helper para Pesquisa de Clientes ---
  window.openClientDropdown = () => {
    const dropdown = document.getElementById("clientDropdown");
    const input = document.getElementById("clientSearchInput");
    if (dropdown && input) {
      const val = input.value;
      const filtered = state.clients.filter((c) =>
        c.nome.toLowerCase().includes(val.toLowerCase())
      );

      dropdown.innerHTML =
        filtered
          .map(
            (c) => `
            <div onclick="window.selectClient('${c.nome.replace(
              /'/g,
              "\\'"
            )}')" 
                 class="p-3 hover:bg-amber-500/10 rounded-xl cursor-pointer transition-all group flex justify-between items-center text-left">
                <span class="font-bold text-slate-300 group-hover:text-white">${
                  c.nome
                }</span>
                ${
                  c.plano && c.plano !== "Nenhum"
                    ? `<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">${c.plano}</span>`
                    : ""
                }
            </div>
        `
          )
          .join("") ||
        `<div class="p-4 text-center text-slate-500 text-xs italic">Nenhum cliente encontrado.</div>`;

      dropdown.classList.remove("hidden");
      state.isClientDropdownOpen = true;
    }
  };

  window.filterClients = (val) => {
    state.clientSearch = val;
    const dropdown = document.getElementById("clientDropdown");
    const hiddenInput = document.querySelector('input[name="client"]');
    if (hiddenInput) hiddenInput.value = val;

    if (dropdown) {
      const filtered = state.clients.filter((c) =>
        c.nome.toLowerCase().includes(val.toLowerCase())
      );
      dropdown.innerHTML =
        filtered
          .map(
            (c) => `
            <div onclick="window.selectClient('${c.nome.replace(
              /'/g,
              "\\'"
            )}')" 
                 class="p-3 hover:bg-amber-500/10 rounded-xl cursor-pointer transition-all group flex justify-between items-center text-left">
                <span class="font-bold text-slate-300 group-hover:text-white">${
                  c.nome
                }</span>
                ${
                  c.plano && c.plano !== "Nenhum"
                    ? `<span class="text-[9px] font-black uppercase px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-500 border border-amber-500/20">${c.plano}</span>`
                    : ""
                }
            </div>
        `
          )
          .join("") ||
        `<div class="p-4 text-center text-slate-500 text-xs italic">Nenhum cliente encontrado.</div>`;
      dropdown.classList.remove("hidden");
    }
  };

  window.selectClient = (name) => {
    state.clientSearch = name;
    state.isClientDropdownOpen = false;

    const input = document.getElementById("clientSearchInput");
    const hiddenInput = document.querySelector('input[name="client"]');
    const dropdown = document.getElementById("clientDropdown");

    if (input) input.value = name;
    if (hiddenInput) hiddenInput.value = name;
    if (dropdown) dropdown.classList.add("hidden");
  };

  // Global mousedown once
  if (!window.hasGlobalClientPickerListener) {
    document.addEventListener("mousedown", (e) => {
      const dropdown = document.getElementById("clientDropdown");
      if (dropdown && !dropdown.classList.contains("hidden")) {
        if (
          !e.target.closest("#clientSearchInput") &&
          !e.target.closest("#clientDropdown")
        ) {
          dropdown.classList.add("hidden");
          state.isClientDropdownOpen = false;
        }
      }
    });
    window.hasGlobalClientPickerListener = true;
  }

  window.updatePriceByService = (serviceName) => {
    const proc = state.procedures.find((p) => p.nome === serviceName);
    if (proc) {
      const priceInput = document.querySelector('input[name="value"]');
      if (priceInput) priceInput.value = proc.preco;
    }
  };

  window.saveNewRecord = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');

    const recordData = {
      data: formData.get("date"),
      horario: formData.get("time"),
      cliente: formData.get("client"),
      procedimento: formData.get("service"),
      valor: parseFloat(formData.get("value")) || 0,
      forma_pagamento: formData.get("payment"),
    };

    btn.disabled = true;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Salvando...';

    try {
      const url =
        isEditing && state.editingRecord.id
          ? `${state.supabaseUrl}/rest/v1/agendamentos?id=eq.${state.editingRecord.id}`
          : `${state.supabaseUrl}/rest/v1/agendamentos`;

      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(recordData),
      });

      if (res.ok) {
        alert("✅ Agendamento concluído com sucesso!");
        if (isEditing) {
          state.editingRecord = null;
          state.currentPage = "records";
        } else {
          e.target.reset();
          state.clientSearch = ""; // Limpa busca após novo registro
        }
        fetchAgendamentos(); // Atualiza os dados locais
      } else {
        const errorData = await res.json();
        console.error("Erro Supabase:", errorData);
        alert(
          `❌ Erro ao salvar: ${
            errorData.message || errorData.hint || "Verifique os dados."
          }`
        );
      }
    } catch (err) {
      console.error(err);
      alert("❌ Erro de conexão.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = isEditing ? "Salvar Alterações" : "Salvar Agendamento";
    }
  };

  const today = new Date().toISOString().split("T")[0];
  const initialValues = state.editingRecord || {
    date: today,
    time: "",
    client: "",
    service: "",
    value: "",
    paymentMethod: "PIX",
  };

  return `
        <div class="p-4 sm:p-8 max-w-4xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div class="glass-card p-6 sm:p-10 rounded-[2rem] sm:rounded-[3rem] border border-white/5">
                <div class="flex items-center space-x-4 mb-8 sm:mb-10">
                    <div class="w-12 h-12 sm:w-16 sm:h-16 rounded-2xl bg-amber-500/10 flex items-center justify-center text-amber-500 shrink-0">
                        <i class="fas ${
                          isEditing ? "fa-edit" : "fa-calendar-plus"
                        } text-2xl sm:text-3xl"></i>
                    </div>
                    <div>
                        <h2 class="text-2xl sm:text-4xl font-display font-black tracking-tight">${
                          isEditing ? "Editar Agendamento" : "Novo Agendamento"
                        }</h2>
                        <p class="text-slate-500 text-xs sm:text-sm font-medium">${
                          isEditing
                            ? "Altere as informações abaixo"
                            : "Selecione um cliente para agendar"
                        }</p>
                    </div>
                </div>

                <form onsubmit="window.saveNewRecord(event)" class="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div class="space-y-2">
                        <label class="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Data</label>
                        <input type="date" name="date" required value="${
                          initialValues.date || initialValues.data
                        }"
                               class="w-full bg-dark-900 border border-white/5 p-4 rounded-2xl outline-none focus:border-amber-500/50 transition-all font-bold">
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Horário</label>
                        <input type="time" name="time" required value="${
                          initialValues.time || initialValues.horario
                        }"
                               class="w-full bg-dark-900 border border-white/5 p-4 rounded-2xl outline-none focus:border-amber-500/50 transition-all font-bold">
                    </div>

                    <div class="space-y-2 col-span-1 md:col-span-2">
                        <label class="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Cliente</label>
                        <div class="relative">
                            <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                            <input type="text" 
                                   id="clientSearchInput"
                                   placeholder="Digite para pesquisar..."
                                   autocomplete="off"
                                   required
                                   value="${state.clientSearch || ""}"
                                   onfocus="window.openClientDropdown()"
                                   oninput="window.filterClients(this.value)"
                                   onkeydown="if(event.key === 'Enter') event.preventDefault()"
                                   class="w-full bg-dark-900 border border-white/5 py-4 pl-12 pr-4 rounded-2xl outline-none focus:border-amber-500/50 transition-all font-bold">
                            
                            <!-- Hidden input to store the final selected value for the form -->
                            <input type="hidden" name="client" value="${
                              state.clientSearch || ""
                            }">

                             <!-- Dropdown de Sugestões -->
                            <div id="clientDropdown" class="hidden absolute z-50 left-0 right-0 mt-2 bg-dark-900 border border-white/10 rounded-2xl shadow-2xl max-h-60 overflow-y-auto custom-scroll p-2">
                                <!-- Conteúdo gerado via JS em filterClients ou openClientDropdown -->
                            </div>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Serviço/Procedimento</label>
                        <div class="relative">
                            <select name="service" required onchange="window.updatePriceByService(this.value)"
                                    class="w-full bg-dark-900 border border-white/5 p-4 rounded-2xl outline-none focus:border-amber-500/50 transition-all font-bold appearance-none">
                                <option value="">Selecione...</option>
                                ${state.procedures
                                  .map(
                                    (p) => `
                                <option value="${p.nome}" data-price="${
                                      p.preco
                                    }" ${
                                      (initialValues.service ||
                                        initialValues.procedimento) === p.nome
                                        ? "selected"
                                        : ""
                                    } class="uppercase">${p.nome.toUpperCase()}</option>
                                `
                                  )
                                  .join("")}
                                <option value="Outro" ${
                                  (initialValues.service ||
                                    initialValues.procedimento) &&
                                  !state.procedures.find(
                                    (p) =>
                                      p.nome ===
                                      (initialValues.service ||
                                        initialValues.procedimento)
                                  )
                                    ? "selected"
                                    : ""
                                }>Outro / Personalizado</option>
                            </select>
                            <i class="fas fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"></i>
                        </div>
                    </div>

                    <div class="space-y-2">
                        <label class="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Valor (R$)</label>
                        <input type="number" step="0.01" name="value" placeholder="0,00" value="${
                          initialValues.value || initialValues.valor
                        }"
                               class="w-full bg-dark-900 border border-white/5 p-4 rounded-2xl outline-none focus:border-amber-500/50 transition-all font-bold">
                    </div>

                    <div class="space-y-2 col-span-1 md:col-span-2">
                        <label class="text-xs font-black uppercase tracking-widest text-slate-500 ml-1">Forma de Pagamento</label>
                        <div class="relative">
                            <select name="payment" required
                                    class="w-full bg-dark-900 border border-white/5 p-4 rounded-2xl outline-none focus:border-amber-500/50 transition-all font-bold appearance-none">
                                ${[
                                  "PIX",
                                  "DINHEIRO",
                                  "CARTÃO",
                                  "PLANO MENSAL",
                                  "CORTESIA",
                                ]
                                  .map(
                                    (p) => `
                                    <option value="${p}" ${
                                      (initialValues.paymentMethod ||
                                        initialValues.forma_pagamento) === p
                                        ? "selected"
                                        : ""
                                    }>${p}${
                                      p === "CARTÃO" ? " DE CRÉDITO/DÉBITO" : ""
                                    }</option>
                                `
                                  )
                                  .join("")}
                            </select>
                            <i class="fas fa-chevron-down absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none"></i>
                        </div>
                    </div>

                    <div class="col-span-1 md:col-span-2 pt-6">
                        <button type="submit" ${
                          state.clients.length === 0 ? "disabled" : ""
                        }
                                class="w-full bg-amber-500 disabled:bg-white/5 disabled:text-white/20 text-dark-950 font-black py-5 rounded-2xl border border-transparent shadow-xl shadow-amber-500/20 transform hover:-translate-y-1 transition-all active:scale-95 uppercase tracking-widest">
                            ${
                              isEditing
                                ? "Salvar Alterações"
                                : "Salvar Agendamento"
                            }
                        </button>
                    </div>
                </form>
            </div>
        </div>
    `;
};

/**
 * PÁGINA: Gestão Local (Clientes e Procedimentos)
 */
const ClientsPage = () => {
  // --- View Toggle ---
  window.switchClientView = (view) => {
    state.clientView = view;
    state.editingClient = null;
    state.editingProcedure = null;
    state.managementSearch = "";
    render();
  };

  window.handleManagementSearch = (val) => {
    state.managementSearch = val;
    render();
  };

  // --- Client Logic ---
  window.saveNewClient = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');
    const isEditing = !!state.editingClient;

    const clientData = {
      nome: formData.get("nome"),
      telefone: formData.get("telefone") || null,
      plano: formData.get("plano") || "Nenhum",
    };

    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${
      isEditing ? "Salvando..." : "Cadastrando..."
    }`;

    try {
      const url = isEditing
        ? `${state.supabaseUrl}/rest/v1/clientes?id=eq.${state.editingClient.id}`
        : `${state.supabaseUrl}/rest/v1/clientes`;

      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(clientData),
      });

      if (res.ok) {
        state.editingClient = null;
        e.target.reset();
        fetchClients();
      } else {
        const errorData = await res.json();
        if (errorData.code === "23505")
          alert("❌ ERRO: Este cliente já está cadastrado.");
        else
          alert(
            "❌ Erro ao salvar: " +
              (errorData.message || "Falha no banco de dados.")
          );
      }
    } catch (err) {
      alert("❌ Erro de conexão.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = isEditing ? "Salvar Alterações" : "Cadastrar Cliente";
    }
  };

  window.editClient = (client) => {
    state.clientView = "clients";
    state.editingClient = client;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.cancelEditClient = () => {
    state.editingClient = null;
    render();
  };

  window.deleteClient = async (id) => {
    if (
      !confirm(
        "Deseja excluir este cliente? Isso não afetará os agendamentos já feitos."
      )
    )
      return;
    try {
      await fetch(`${state.supabaseUrl}/rest/v1/clientes?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
        },
      });
      fetchClients();
    } catch (err) {
      alert("Erro ao excluir cliente.");
    }
  };

  // --- Procedure Logic ---
  window.saveProcedure = async (e) => {
    e.preventDefault();
    const formData = new FormData(e.target);
    const btn = e.target.querySelector('button[type="submit"]');
    const isEditing = !!state.editingProcedure;

    const procedureData = {
      nome: formData.get("nome"),
      preco: parseFloat(formData.get("preco")) || 0,
    };

    btn.disabled = true;
    btn.innerHTML = `<i class="fas fa-spinner fa-spin"></i> ${
      isEditing ? "Salvando..." : "Cadastrando..."
    }`;

    try {
      const url = isEditing
        ? `${state.supabaseUrl}/rest/v1/procedimentos?id=eq.${state.editingProcedure.id}`
        : `${state.supabaseUrl}/rest/v1/procedimentos`;

      const res = await fetch(url, {
        method: isEditing ? "PATCH" : "POST",
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(procedureData),
      });

      if (res.ok) {
        state.editingProcedure = null;
        e.target.reset();
        fetchProcedures();
      } else {
        alert("❌ Erro ao salvar procedimento.");
      }
    } catch (err) {
      alert("❌ Erro de conexão.");
    } finally {
      btn.disabled = false;
      btn.innerHTML = isEditing
        ? "Salvar Alterações"
        : "Cadastrar Procedimento";
    }
  };

  window.editProcedure = (proc) => {
    state.clientView = "procedures";
    state.editingProcedure = proc;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  window.cancelEditProcedure = () => {
    state.editingProcedure = null;
    render();
  };

  window.deleteProcedure = async (id) => {
    if (!confirm("Deseja excluir este procedimento?")) return;
    try {
      await fetch(`${state.supabaseUrl}/rest/v1/procedimentos?id=eq.${id}`, {
        method: "DELETE",
        headers: {
          apikey: state.supabaseKey,
          Authorization: "Bearer " + state.supabaseKey,
        },
      });
      fetchProcedures();
    } catch (err) {
      alert("Erro ao excluir procedimento.");
    }
  };

  const isClients = state.clientView === "clients";

  return `
        <div class="p-4 sm:p-8 space-y-6 sm:space-y-8 animate-in fade-in slide-in-from-right-4 duration-500">
            <div class="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                    <h2 class="text-2xl sm:text-3xl font-display font-bold">Gestão Local</h2>
                    <p class="text-slate-500 text-xs sm:text-sm mt-1">Gerencie sua base de clientes e tabela de preços</p>
                </div>

                <!-- Toggle Switch -->
                <div class="flex bg-dark-900 border border-white/5 p-1 rounded-2xl w-full sm:w-auto">
                    <button onclick="window.switchClientView('clients')" 
                            class="flex-1 sm:flex-none px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                              isClients
                                ? "bg-amber-500 text-dark-950 shadow-lg shadow-amber-500/20"
                                : "text-slate-500 hover:text-white"
                            }">
                        Clientes
                    </button>
                    <button onclick="window.switchClientView('procedures')" 
                            class="flex-1 sm:flex-none px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${
                              !isClients
                                ? "bg-amber-500 text-dark-950 shadow-lg shadow-amber-500/20"
                                : "text-slate-500 hover:text-white"
                            }">
                        Procedimentos
                    </button>
                </div>
            </div>

            <div class="grid grid-cols-1 lg:grid-cols-3 gap-8">
                <!-- Cadastro / Edição -->
                <div class="lg:col-span-1">
                    <div class="glass-card p-8 rounded-[2rem] border border-white/5 sticky top-24">
                        ${
                          isClients
                            ? `
                            <div class="flex justify-between items-center mb-6">
                                <h3 class="text-lg font-bold text-amber-500 uppercase tracking-widest text-sm">
                                    ${
                                      state.editingClient
                                        ? "Editar Cliente"
                                        : "Novo Cliente"
                                    }
                                </h3>
                                ${
                                  state.editingClient
                                    ? `
                                    <button onclick="window.cancelEditClient()" class="text-[10px] font-bold text-slate-500 hover:text-white uppercase tracking-widest">
                                        Cancelar
                                    </button>
                                `
                                    : ""
                                }
                            </div>
                            <form onsubmit="window.saveNewClient(event)" class="space-y-6">
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase text-slate-500 ml-1 tracking-widest">Nome Completo</label>
                                    <input type="text" name="nome" required placeholder="Ex: Lucas Ferreira" 
                                           value="${
                                             state.editingClient?.nome || ""
                                           }"
                                           class="w-full bg-dark-900 border border-white/5 p-4 rounded-xl outline-none focus:border-amber-500/50 transition-all font-bold">
                                </div>
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase text-slate-500 ml-1 tracking-widest">Telefone (Opcional)</label>
                                    <input type="text" name="telefone" placeholder="(00) 00000-0000"
                                           value="${
                                             state.editingClient?.telefone || ""
                                           }"
                                           class="w-full bg-dark-900 border border-white/5 p-4 rounded-xl outline-none focus:border-amber-500/50 transition-all font-bold">
                                </div>
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase text-slate-500 ml-1 tracking-widest">Tipo de Plano</label>
                                    <select name="plano" 
                                            class="w-full bg-dark-900 border border-white/5 p-4 rounded-xl outline-none focus:border-amber-500/50 transition-all font-bold appearance-none">
                                        <option value="Nenhum" ${
                                          state.editingClient?.plano ===
                                          "Nenhum"
                                            ? "selected"
                                            : ""
                                        }>Nenhum Plano</option>
                                        <option value="Mensal" ${
                                          state.editingClient?.plano ===
                                          "Mensal"
                                            ? "selected"
                                            : ""
                                        }>Plano Mensal</option>
                                        <option value="Anual" ${
                                          state.editingClient?.plano === "Anual"
                                            ? "selected"
                                            : ""
                                        }>Plano Anual</option>
                                    </select>
                                </div>
                                <!-- Botão Final de Cadastro -->
                                <button type="submit" class="w-full bg-amber-500 text-dark-950 font-black py-4 rounded-xl border border-transparent transition-all uppercase tracking-widest text-sm shadow-xl shadow-amber-500/10 active:scale-95">
                                    ${
                                      state.editingClient
                                        ? "Salvar Alterações"
                                        : "Cadastrar Cliente"
                                    }
                                </button>
                            </form>
                        `
                            : `
                            <div class="flex justify-between items-center mb-6">
                                <h3 class="text-lg font-bold text-amber-500 uppercase tracking-widest text-sm">
                                    ${
                                      state.editingProcedure
                                        ? "Editar Serviço"
                                        : "Novo Serviço"
                                    }
                                </h3>
                                ${
                                  state.editingProcedure
                                    ? `
                                    <button onclick="window.cancelEditProcedure()" class="text-[10px] font-bold text-slate-500 hover:text-white uppercase tracking-widest">
                                        Cancelar
                                    </button>
                                `
                                    : ""
                                }
                            </div>
                            <form onsubmit="window.saveProcedure(event)" class="space-y-6">
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase text-slate-500 ml-1 tracking-widest">Nome do Serviço</label>
                                    <input type="text" name="nome" required placeholder="Ex: Corte Degradê" 
                                           value="${
                                             state.editingProcedure?.nome || ""
                                           }"
                                           class="w-full bg-dark-900 border border-white/5 p-4 rounded-xl outline-none focus:border-amber-500/50 transition-all font-bold">
                                </div>
                                <div class="space-y-2">
                                    <label class="text-[10px] font-black uppercase text-slate-500 ml-1 tracking-widest">Preço Sugerido (R$ - Opcional)</label>
                                    <input type="number" step="0.01" name="preco" placeholder="0,00"
                                           value="${
                                             state.editingProcedure?.preco || ""
                                           }"
                                           class="w-full bg-dark-900 border border-white/5 p-4 rounded-xl outline-none focus:border-amber-500/50 transition-all font-bold">
                                </div>
                                <button type="submit" class="w-full bg-amber-500 text-dark-950 font-black py-4 rounded-xl hover:bg-amber-400 transition-all uppercase tracking-widest text-sm shadow-xl shadow-amber-500/10 active:scale-95">
                                    ${
                                      state.editingProcedure
                                        ? "Salvar Alterações"
                                        : "Adicionar Serviço"
                                    }
                                </button>
                            </form>
                        `
                        }
                    </div>
                </div>

                <!-- Lista -->
                <div class="lg:col-span-2">
                    <div class="glass-card rounded-[2rem] overflow-hidden border border-white/5">
                        <div class="p-6 bg-white/[0.02] border-b border-white/5 space-y-4">
                            <div class="flex justify-between items-center">
                                <h3 class="font-bold flex items-center">
                                    <i class="fas ${
                                      isClients
                                        ? "fa-users-viewfinder"
                                        : "fa-list-check"
                                    } mr-3 text-amber-500"></i>
                                    ${
                                      isClients
                                        ? `Clientes Registrados (${state.clients.length})`
                                        : `Procedimentos Ativos (${state.procedures.length})`
                                    }
                                </h3>
                                <button onclick="${
                                  isClients
                                    ? "fetchClients()"
                                    : "fetchProcedures()"
                                }" class="w-10 h-10 rounded-xl bg-white/5 hover:bg-amber-500/10 hover:text-amber-500 transition-all flex items-center justify-center">
                                    <i class="fas fa-sync-alt"></i>
                                </button>
                            </div>
                            <div class="relative">
                                <i class="fas fa-search absolute left-4 top-1/2 -translate-y-1/2 text-slate-500"></i>
                                <input type="text" 
                                       id="managementSearchInput"
                                       placeholder="Pesquisar ${
                                         isClients ? "cliente" : "procedimento"
                                       }..." 
                                       oninput="window.handleManagementSearch(this.value)"
                                       value="${state.managementSearch}"
                                       class="w-full bg-dark-900 border border-white/5 py-3 pl-12 pr-4 rounded-xl text-sm outline-none focus:border-amber-500/50 transition-all font-medium">
                            </div>
                        </div>
                        
                        <div class="max-h-[600px] overflow-y-auto custom-scroll">
                            ${
                              isClients
                                ? `
                                <!-- Table Clients -->
                                <div class="hidden sm:block">
                                    <table class="w-full text-left">
                                        <thead class="bg-white/[0.01] text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                            <tr>
                                                <th class="px-8 py-4 border-b border-white/5">Nome</th>
                                                <th class="px-8 py-4 border-b border-white/5">Plano</th>
                                                <th class="px-8 py-4 border-b border-white/5">Telefone</th>
                                                <th class="px-8 py-4 border-b border-white/5 text-right">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-white/5 text-sm">
                                            ${state.clients
                                              .filter((c) =>
                                                c.nome
                                                  .toLowerCase()
                                                  .includes(
                                                    state.managementSearch.toLowerCase()
                                                  )
                                              )
                                              .map(
                                                (c) => `
                                                <tr class="hover:bg-white/[0.01] transition-colors group">
                                                    <td class="px-8 py-4 font-bold text-white uppercase">${
                                                      c.nome
                                                    }</td>
                                                    <td class="px-8 py-4">
                                                        <span class="px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest
                                                            ${
                                                              c.plano ===
                                                              "Mensal"
                                                                ? "bg-amber-500/10 text-amber-500 border border-amber-500/20"
                                                                : c.plano ===
                                                                  "Anual"
                                                                ? "bg-purple-500/10 text-purple-400 border border-purple-500/20"
                                                                : "text-slate-500 border border-white/5"
                                                            }">
                                                            ${
                                                              c.plano ||
                                                              "Nenhum"
                                                            }
                                                        </span>
                                                    </td>
                                                    <td class="px-8 py-4 text-slate-400 font-medium">${
                                                      c.telefone || "---"
                                                    }</td>
                                                    <td class="px-8 py-4 text-right">
                                                        <div class="flex justify-end space-x-2">
                                                            <button onclick='window.editClient(${JSON.stringify(
                                                              c
                                                            )})' 
                                                                    class="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all transform active:scale-90">
                                                                <i class="fas fa-edit"></i>
                                                            </button>
                                                            <button onclick="window.deleteClient('${
                                                              c.id
                                                            }')" 
                                                                    class="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all transform active:scale-90">
                                                                <i class="fas fa-trash-alt"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            `
                                              )
                                              .join("")}
                                        </tbody>
                                    </table>
                                </div>
                                <!-- Mobile Client Cards -->
                                <div class="sm:hidden divide-y divide-white/5">
                                    ${state.clients
                                      .filter((c) =>
                                        c.nome
                                          .toLowerCase()
                                          .includes(
                                            state.managementSearch.toLowerCase()
                                          )
                                      )
                                      .map(
                                        (c) => `
                                        <div class="p-6 space-y-4">
                                            <div class="flex justify-between items-start">
                                                <div><p class="text-lg font-bold text-white uppercase">${
                                                  c.nome
                                                }</p></div>
                                                <div class="flex space-x-2">
                                                    <button onclick='window.editClient(${JSON.stringify(
                                                      c
                                                    )})' class="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center"><i class="fas fa-edit"></i></button>
                                                    <button onclick="window.deleteClient('${
                                                      c.id
                                                    }')" class="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center"><i class="fas fa-trash-alt"></i></button>
                                                </div>
                                            </div>
                                            <div class="flex items-center space-x-4">
                                                <span class="px-3 py-1 rounded-full text-[9px] font-black uppercase tracking-widest ${
                                                  c.plano === "Mensal"
                                                    ? "bg-amber-500/10 text-amber-500"
                                                    : "text-slate-500 border border-white/5"
                                                }">${c.plano || "Nenhum"}</span>
                                                <span class="text-xs text-slate-500">${
                                                  c.telefone || ""
                                                }</span>
                                            </div>
                                        </div>
                                    `
                                      )
                                      .join("")}
                                </div>
                            `
                                : `
                                <!-- Table Procedures -->
                                <div class="hidden sm:block">
                                    <table class="w-full text-left">
                                        <thead class="bg-white/[0.01] text-[10px] font-black text-slate-500 uppercase tracking-widest">
                                            <tr>
                                                <th class="px-8 py-4 border-b border-white/5">Serviço</th>
                                                <th class="px-8 py-4 border-b border-white/5">Preço Base</th>
                                                <th class="px-8 py-4 border-b border-white/5 text-right">Ações</th>
                                            </tr>
                                        </thead>
                                        <tbody class="divide-y divide-white/5 text-sm">
                                            ${state.procedures
                                              .filter((p) =>
                                                p.nome
                                                  .toLowerCase()
                                                  .includes(
                                                    state.managementSearch.toLowerCase()
                                                  )
                                              )
                                              .map(
                                                (p) => `
                                                <tr class="hover:bg-white/[0.01] transition-colors group">
                                                    <td class="px-8 py-4 font-bold text-white uppercase">${
                                                      p.nome
                                                    }</td>
                                                    <td class="px-8 py-4 text-emerald-400 font-black">R$ ${p.preco
                                                      .toFixed(2)
                                                      .replace(".", ",")}</td>
                                                    <td class="px-8 py-4 text-right">
                                                        <div class="flex justify-end space-x-2">
                                                            <button onclick='window.editProcedure(${JSON.stringify(
                                                              p
                                                            )})' 
                                                                    class="w-9 h-9 rounded-xl bg-blue-500/10 text-blue-500 hover:bg-blue-500 hover:text-white transition-all transform active:scale-90">
                                                                <i class="fas fa-edit"></i>
                                                            </button>
                                                            <button onclick="window.deleteProcedure('${
                                                              p.id
                                                            }')" 
                                                                    class="w-9 h-9 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all transform active:scale-90">
                                                                <i class="fas fa-trash-alt"></i>
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            `
                                              )
                                              .join("")}
                                        </tbody>
                                    </table>
                                </div>
                                <!-- Mobile Procedure Cards -->
                                <div class="sm:hidden divide-y divide-white/5">
                                    ${state.procedures
                                      .filter((p) =>
                                        p.nome
                                          .toLowerCase()
                                          .includes(
                                            state.managementSearch.toLowerCase()
                                          )
                                      )
                                      .map(
                                        (p) => `
                                        <div class="p-6 flex justify-between items-center">
                                            <div>
                                                <p class="text-lg font-bold text-white uppercase">${
                                                  p.nome
                                                }</p>
                                                <p class="text-emerald-400 font-black">R$ ${p.preco
                                                  .toFixed(2)
                                                  .replace(".", ",")}</p>
                                            </div>
                                            <div class="flex space-x-2">
                                                <button onclick='window.editProcedure(${JSON.stringify(
                                                  p
                                                )})' class="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-500 flex items-center justify-center"><i class="fas fa-edit"></i></button>
                                                <button onclick="window.deleteProcedure('${
                                                  p.id
                                                }')" class="w-10 h-10 rounded-xl bg-rose-500/10 text-rose-500 flex items-center justify-center"><i class="fas fa-trash-alt"></i></button>
                                            </div>
                                        </div>
                                    `
                                      )
                                      .join("")}
                                </div>
                            `
                            }
                            ${
                              (isClients
                                ? state.clients
                                : state.procedures
                              ).filter((x) =>
                                x.nome
                                  .toLowerCase()
                                  .includes(
                                    state.managementSearch.toLowerCase()
                                  )
                              ).length === 0
                                ? '<div class="p-20 text-center text-slate-500 font-bold italic">Nenhum registro encontrado.</div>'
                                : ""
                            }
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

/**
 * PÁGINA: Configurações e Tema
 */
const SetupPage = () => {
  window.updateColor = (hex) => {
    state.theme.accent = hex;
    state.theme.accentRgb = hexToRgb(hex);
    applyTheme();
    render();
  };

    window.saveApiSettings = () => {
        const url = document.getElementById('supabaseUrlInput').value.trim();
        const key = document.getElementById('supabaseKeyInput').value.trim();
        
        if (!url || !key) return alert('Por favor, preencha a URL e a Key do Supabase.');
        
        localStorage.setItem('supabaseUrl', url);
        localStorage.setItem('supabaseKey', key);
        state.supabaseUrl = url;
        state.supabaseKey = key;
        
        alert('Configurações de API salvas! Sincronizando dados...');
        fetchAgendamentos();
        fetchClients();
        fetchProcedures();
        render();
    };

    window.showSupabaseGuide = () => {
        state.showGuide = true;
        render();
    };

    window.closeGuide = () => {
        state.showGuide = false;
        render();
    };

    window.copySQL = () => {
        const sqlText = `
-- 1. Tabela de Clientes
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    nome TEXT NOT NULL,
    telefone TEXT,
    plano TEXT DEFAULT 'Nenhum'
);

-- 2. Tabela de Procedimentos
CREATE TABLE IF NOT EXISTS procedimentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    nome TEXT NOT NULL,
    preco DECIMAL(10,2) NOT NULL
);

-- 3. Tabela de Agendamentos
CREATE TABLE IF NOT EXISTS agendamentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    data DATE NOT NULL,
    horario TIME NOT NULL,
    cliente TEXT NOT NULL,
    procedimento TEXT NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    forma_pagamento TEXT NOT NULL
);

-- Habilitar acesso público para testes (opcional, configure RLS depois)
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON clientes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE procedimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON procedimentos FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public Access" ON agendamentos FOR ALL USING (true) WITH CHECK (true);
        `.trim();
        
        navigator.clipboard.writeText(sqlText).then(() => {
            alert('Código SQL copiado para a área de transferência!');
        });
    };

    window.disconnectSaaS = () => {
        if (confirm('Deseja realmente desconectar e limpar todas as credenciais?')) {
            localStorage.removeItem('supabaseUrl');
            localStorage.removeItem('supabaseKey');
            localStorage.removeItem('isIntegrated');
            state.supabaseUrl = '';
            state.supabaseKey = '';
            state.isIntegrated = false;
            state.records = [];
            state.clients = [];
            state.procedures = [];
            render();
        }
    };

    return `
        <div class="p-4 sm:p-8 flex items-center justify-center min-h-[80vh] animate-in fade-in duration-500">
            <div class="max-w-2xl w-full glass-card p-6 sm:p-12 rounded-[2rem] sm:rounded-[3rem] border border-white/5 shadow-2xl">
                <div class="text-center space-y-6">
                    <div class="inline-flex p-4 rounded-3xl bg-amber-500/10 text-amber-500 mb-2">
                        <i class="fas fa-database text-3xl"></i>
                    </div>
                    <h2 class="text-4xl font-display font-black uppercase italic text-amber-500">Configuração SaaS</h2>
                    <p class="text-slate-400">Conecte sua própria instância do Supabase para gerenciar seus dados.</p>
                    
                    <!-- Supabase Config -->
                    <div class="space-y-4 pt-8 text-left pb-8">
                        <div class="flex justify-between items-center mb-4">
                            <h3 class="text-xs font-black uppercase text-amber-500 tracking-[0.2em]">Conexão Supabase (API)</h3>
                            <button onclick="window.showSupabaseGuide()" class="text-[10px] font-black bg-amber-500/10 text-amber-500 px-3 py-1 rounded-full border border-amber-500/20 hover:bg-amber-400 hover:text-dark-950 transition-all">
                                <i class="fas fa-circle-info mr-1"></i> GUIA
                            </button>
                        </div>
                        
                        <div class="space-y-4">
                            <div>
                                <label class="text-[10px] font-bold text-slate-500 uppercase ml-1">Supabase Project URL</label>
                                <input type="text" id="supabaseUrlInput" 
                                       value="${state.supabaseUrl || ''}" 
                                       placeholder="https://xxxx.supabase.co" 
                                       class="w-full bg-dark-900 border border-white/10 p-4 rounded-xl outline-none focus:border-amber-500 transition-all font-mono text-xs">
                            </div>
                            <div>
                                <label class="text-[10px] font-bold text-slate-500 uppercase ml-1">Supabase Anon Key</label>
                                <input type="password" id="supabaseKeyInput" 
                                       value="${state.supabaseKey || ''}" 
                                       placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." 
                                       class="w-full bg-dark-900 border border-white/10 p-4 rounded-xl outline-none focus:border-amber-500 transition-all font-mono text-xs">
                            </div>
                            
                            <div class="flex gap-4">
                                <button onclick="window.saveApiSettings()" 
                                        class="flex-1 bg-amber-500 text-dark-950 p-4 rounded-xl font-bold border border-transparent hover:bg-amber-400 transition-all uppercase tracking-widest text-xs">
                                    Conectar e Sincronizar
                                </button>
                                
                                ${state.isIntegrated ? `
                                    <button onclick="window.disconnectSaaS()" 
                                            class="px-6 bg-rose-500/10 text-rose-500 border border-rose-500/20 rounded-xl font-bold hover:bg-rose-500 hover:text-white transition-all">
                                        <i class="fas fa-trash-alt"></i>
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    <div class="text-[10px] text-slate-600 mt-8 space-y-1 uppercase tracking-wider font-bold">
                        <p>Os dados são armazenados de forma segura e privada.</p>
                    </div>
                </div>

                <!-- Configuração de Tema -->
                <div class="mt-12 pt-12 border-t border-white/5 text-left">
                    <h3 class="text-xl font-bold mb-2">Personalização</h3>
                    <p class="text-slate-500 text-sm mb-8">Escolha a cor de destaque do seu dashboard.</p>
                    
                    <div class="grid grid-cols-1 md:grid-cols-2 gap-8">
                        <div class="space-y-4">
                            <label class="text-xs font-bold text-slate-500 uppercase">Cor de Destaque</label>
                            <div class="flex items-center space-x-4 bg-dark-900 border border-white/10 p-4 rounded-2xl">
                                <input type="color" 
                                       id="colorPicker" 
                                       value="${state.theme.accent}"
                                       oninput="window.updateColor(this.value)"
                                       class="w-12 h-12 rounded-lg bg-transparent border-none cursor-pointer">
                                <span class="font-mono text-sm font-bold uppercase">${
                                  state.theme.accent
                                }</span>
                            </div>
                        </div>

                        <div class="space-y-4">
                            <label class="text-xs font-bold text-slate-500 uppercase">Sugestões (Premium)</label>
                            <div class="flex flex-wrap gap-3">
                                ${[
                                  "#F59E0B",
                                  "#10B981",
                                  "#3B82F6",
                                  "#8B5CF6",
                                  "#F43F5E",
                                  "#737373",
                                ]
                                  .map(
                                    (color) => `
                                    <button onclick="window.updateColor('${color}')" 
                                            class="w-8 h-8 rounded-full border-2 ${
                                              state.theme.accent === color
                                                ? "border-white"
                                                : "border-transparent"
                                            }"
                                            style="background-color: ${color}"></button>
                                `
                                  )
                                  .join("")}
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const LoginPage = () => {
  window.signInWithGoogle = async () => {
    // Para o login, usamos as chaves da plataforma (Master)
    const authClient = window.supabase.createClient(SAAS_MASTER_URL, SAAS_MASTER_KEY);
    
    if (SAAS_MASTER_URL === "SUA_URL_MASTER_AQUI") {
      return alert("Erro crítico: O administrador do SaaS não configurou as chaves Master da plataforma.");
    }

    await authClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin
      }
    });
  };

  return `
        <div class="flex items-center justify-center min-h-screen w-full bg-pattern p-4 animate-in fade-in duration-700">
            <div class="max-w-md w-full glass-card p-10 rounded-[3rem] text-center space-y-8 animate-in zoom-in-95 duration-500 shadow-2xl">
                <div class="w-20 h-20 bg-amber-500/10 rounded-3xl flex items-center justify-center text-amber-500 mx-auto">
                    <i class="fas fa-rocket text-3xl"></i>
                </div>
                <div>
                    <h2 class="text-3xl font-display font-black text-white uppercase italic tracking-tighter">Barber <span class="text-amber-500">SaaS</span></h2>
                    <p class="text-slate-400 mt-2 text-sm leading-relaxed">Faça login com sua conta Google para gerenciar sua barbearia.</p>
                </div>

                <button onclick="window.signInWithGoogle()" 
                        class="w-full bg-white text-dark-950 font-black py-5 rounded-2xl flex items-center justify-center gap-3 hover:bg-amber-500 transition-all transform active:scale-95 shadow-xl shadow-white/5 uppercase tracking-widest text-xs">
                    <i class="fab fa-google text-lg"></i>
                    Entrar com Google
                </button>
                
                <div class="flex flex-col gap-4">
                    <p class="text-[10px] text-slate-600 uppercase font-black tracking-[0.2em]">Bem-vindo à nova era da gestão</p>
                    
                    <div class="flex justify-center gap-4 text-[10px] uppercase font-black text-slate-500/50 pt-4 border-t border-white/5">
                        <a href="privacy.html" target="_blank" class="hover:text-amber-500 transition-all">Privacidade</a>
                        <span class="opacity-20">|</span>
                        <a href="terms.html" target="_blank" class="hover:text-amber-500 transition-all">Termos de Uso</a>
                    </div>
                </div>
            </div>
        </div>
    `;
};

const pages = {
  dashboard: Dashboard,
  records: RecordsPage,
  manage: ManagePage,
  clients: ClientsPage,
  setup: SetupPage,
};

// ==========================================
// 8. MOTOR DE RENDERIZAÇÃO E INICIALIZAÇÃO
// ==========================================
function render() {
  const app = document.getElementById("app");

  // SE NÃO HOUVER USUÁRIO LOGADO, O LOGIN É OBRIGATÓRIO (Porta de entrada)
  if (!state.user) {
    app.innerHTML = LoginPage();
    return;
  }

  // Captura o foco e seleção antes de renderizar
  const activeId = document.activeElement ? document.activeElement.id : null;
  const selection =
    document.activeElement &&
    (document.activeElement.tagName === "INPUT" ||
      document.activeElement.tagName === "TEXTAREA")
      ? {
          start: document.activeElement.selectionStart,
          end: document.activeElement.selectionEnd,
        }
      : null;

  const contentFn = pages[state.currentPage] || (() => "404");
  const content = contentFn();

  app.innerHTML = `
        <div class="flex h-full w-full bg-pattern text-white overflow-hidden">
            ${Sidebar()}
            <div class="flex-1 flex flex-col min-w-0 h-full relative">
                ${Header()}
                <main class="flex-1 overflow-y-auto custom-scroll pb-24 md:pb-0">
                    ${content}
                </main>
                ${MobileNav()}
                ${GuideOverlay()}
            </div>
        </div>
    `;

  // Restaura o foco e posição do cursor
  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (selection && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) {
        el.setSelectionRange(selection.start, selection.end);
      }
    }
  }
}

// Global exposure
window.navigate = navigate;

window.signOut = async () => {
  const client = getSupabase();
  if (client) {
    await client.auth.signOut();
    state.user = null;
    render();
  }
};

document.addEventListener("DOMContentLoaded", async () => {
  applyTheme();
  
  try {
    if (SAAS_MASTER_URL && SAAS_MASTER_URL !== "SUA_URL_MASTER_AQUI") {
      const client = window.supabase.createClient(SAAS_MASTER_URL, SAAS_MASTER_KEY);
      if (client) {
        const { data: { session } } = await client.auth.getSession();
        state.user = session ? session.user : null;
        
        client.auth.onAuthStateChange((_event, session) => {
          state.user = session ? session.user : null;
          if (state.user && state.supabaseUrl && state.supabaseKey) {
            fetchClients();
            fetchProcedures();
            fetchAgendamentos();
          }
          render();
        });

        if (state.user && state.supabaseUrl && state.supabaseKey) {
          fetchClients();
          fetchProcedures();
          fetchAgendamentos();
        }
      }
    }
  } catch (err) {
    console.error("Falha ao inicializar o cliente Master:", err);
  }
  
  render();
});
const GuideOverlay = () => {
    if (!state.showGuide) return '';
    
    return `
        <div class="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-dark-950/95 backdrop-blur-2xl animate-in fade-in duration-300">
            <div class="max-w-3xl w-full glass-card rounded-[2.5rem] border border-white/10 shadow-2xl overflow-hidden animate-in zoom-in-95 duration-500 flex flex-col max-h-[95vh]">
                <!-- Header Fixo -->
                <div class="p-6 sm:p-10 border-b border-white/5 flex justify-between items-center bg-white/[0.02]">
                    <div>
                        <div class="flex items-center gap-3 mb-1">
                            <i class="fas fa-rocket text-amber-500 text-xl"></i>
                            <h2 class="text-2xl sm:text-3xl font-display font-black text-white italic uppercase tracking-tighter">Guia de Implantação <span class="text-amber-500">SaaS</span></h2>
                        </div>
                        <p class="text-slate-400 text-xs sm:text-sm font-medium">Siga este manual para configurar seu banco de dados em minutos.</p>
                    </div>
                    <button onclick="window.closeGuide()" class="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center hover:bg-rose-500/20 hover:text-rose-500 transition-all border border-white/5">
                        <i class="fas fa-times text-lg"></i>
                    </button>
                </div>

                <!-- Conteúdo com Scroll -->
                <div class="flex-1 overflow-y-auto custom-scroll p-6 sm:p-10 space-y-12">
                    
                    <!-- Passo 1 -->
                    <section class="relative pl-12 sm:pl-16">
                        <div class="absolute left-0 top-0 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500 text-dark-950 flex items-center justify-center font-black text-xl shadow-lg shadow-amber-500/20">1</div>
                        <div class="space-y-3">
                            <h3 class="font-bold text-xl text-white uppercase tracking-tight">Criação da Conta e Projeto</h3>
                            <p class="text-sm text-slate-400 leading-relaxed">
                                O <b>Supabase</b> é uma alternativa open-source ao Firebase que fornece um banco de dados PostgreSQL potente. 
                                <br><br>
                                • Acesse <a href="https://supabase.com" target="_blank" class="text-amber-500 underline font-bold">supabase.com</a> e faça login (recomendamos usar sua conta do GitHub).<br>
                                • Clique em <b>"New Project"</b>.<br>
                                • Escolha um nome (ex: "Meu SaaS Gestão"), defina uma senha segura para o banco e selecione a região mais próxima de você (ex: <b>South America (São Paulo)</b>).
                            </p>
                        </div>
                    </section>

                    <!-- Passo 2 -->
                    <section class="relative pl-12 sm:pl-16">
                        <div class="absolute left-0 top-0 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500 text-dark-950 flex items-center justify-center font-black text-xl shadow-lg shadow-amber-500/20">2</div>
                        <div class="space-y-4">
                            <h3 class="font-bold text-xl text-white uppercase tracking-tight">Estruturação de Dados (SQL)</h3>
                            <p class="text-sm text-slate-400 leading-relaxed">
                                Para que o aplicativo funcione, o banco de dados precisa ter tabelas específicas. Vamos criá-las automaticamente usando o <b>SQL Editor</b>.
                                <br><br>
                                1. No menu lateral esquerdo do Supabase, procure pelo ícone de terminal <b>SQL Editor</b>.<br>
                                2. Clique em <b>"New Query"</b> ou <b>"New Blank Query"</b>.<br>
                                3. Copie o código SQL abaixo e cole no editor.<br>
                                4. Clique no botão <b>RUN</b> (ou pressione Ctrl+Enter).
                            </p>
                            
                            <div class="relative group mt-6">
                                <div class="absolute right-4 top-4 z-10">
                                    <button onclick="window.copySQL()" class="bg-amber-500 text-dark-950 px-4 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest hover:scale-105 transition-all shadow-xl shadow-amber-500/20">
                                        <i class="fas fa-copy mr-1"></i> Copiar Código SQL
                                    </button>
                                </div>
                                <div class="bg-dark-950 rounded-2xl border border-white/10 p-6 font-mono text-[11px] leading-relaxed text-slate-400 overflow-x-auto max-h-60 custom-scroll relative">
<pre>-- CRIANDO TABELA DE CLIENTES
CREATE TABLE IF NOT EXISTS clientes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    nome TEXT NOT NULL,
    telefone TEXT,
    plano TEXT DEFAULT 'Nenhum'
);

-- CRIANDO TABELA DE PROCEDIMENTOS
CREATE TABLE IF NOT EXISTS procedimentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    nome TEXT NOT NULL,
    preco DECIMAL(10,2) NOT NULL
);

-- CRIANDO TABELA DE AGENDAMENTOS
CREATE TABLE IF NOT EXISTS agendamentos (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    data DATE NOT NULL,
    horario TIME NOT NULL,
    cliente TEXT NOT NULL,
    procedimento TEXT NOT NULL,
    valor DECIMAL(10,2) NOT NULL,
    forma_pagamento TEXT NOT NULL
);

-- CONFIGURANDO PERMISSÕES (RLS) PARA TESTES
-- Nota: Isso permite leitura/escrita pública. Configure regras de autenticação para produção.
ALTER TABLE clientes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acesso Publico" ON clientes FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE procedimentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acesso Publico" ON procedimentos FOR ALL USING (true) WITH CHECK (true);

ALTER TABLE agendamentos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Acesso Publico" ON agendamentos FOR ALL USING (true) WITH CHECK (true);</pre>
                                </div>
                            </div>
                            <p class="text-[10px] text-slate-500 italic">O código acima cria as tabelas e abilita o acesso público (RLS) para que o dashboard possa ler e escrever dados imediatamente.</p>
                        </div>
                    </section>

                    <!-- Passo 3 -->
                    <section class="relative pl-12 sm:pl-16">
                        <div class="absolute left-0 top-0 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500 text-dark-950 flex items-center justify-center font-black text-xl shadow-lg shadow-amber-500/20">3</div>
                        <div class="space-y-3">
                            <h3 class="font-bold text-xl text-white uppercase tracking-tight">Coleta de Credenciais</h3>
                            <p class="text-sm text-slate-400 leading-relaxed">
                                Agora precisamos "apresentar" o app ao seu novo banco de dados.
                                <br><br>
                                1. No menu lateral do Supabase, clique no ícone de engrenagem <b>(Project Settings)</b>.<br>
                                2. Vá na aba <b>API</b>.<br>
                                3. No card "Project API keys", você verá 2 informações cruciais:<br>
                                &nbsp;&nbsp;&nbsp;• <b>Project URL</b> (começa com https://...)<br>
                                &nbsp;&nbsp;&nbsp;• <b>anon / public</b> (uma chave longa que começa com eyJhbGcp...)
                            </p>
                        </div>
                    </section>

                    <!-- Passo 3 (NOVO) -->
                    <section class="relative pl-12 sm:pl-16">
                        <div class="absolute left-0 top-0 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500 text-dark-950 flex items-center justify-center font-black text-xl shadow-lg shadow-amber-500/20">3</div>
                        <div class="space-y-3">
                            <h3 class="font-bold text-xl text-white uppercase tracking-tight">Ativar Google OAuth</h3>
                            <p class="text-sm text-slate-400 leading-relaxed">
                                Para o botão "Entrar com Google" funcionar e salvar e-mails:
                                <br><br>
                                1. Acesse o <a href="https://console.cloud.google.com/" target="_blank" class="text-amber-500 underline font-bold">Google Cloud Console</a>.<br>
                                2. Crie um <b>ID do cliente OAuth (Web)</b>.<br>
                                3. No Supabase, vá em <b>Authentication > Providers > Google</b> e ative-o.<br>
                                4. Copie o <b>Redirect URI</b> do Supabase e cole nas configurações do Google.<br>
                                5. Insira o <b>Client ID</b> e <b>Secret</b> do Google no Supabase e salve.
                            </p>
                        </div>
                    </section>

                    <!-- Passo 5 (Novo) -->
                    <section class="relative pl-12 sm:pl-16">
                        <div class="absolute left-0 top-0 w-10 h-10 sm:w-12 sm:h-12 rounded-2xl bg-amber-500 text-dark-950 flex items-center justify-center font-black text-xl shadow-lg shadow-amber-500/20">5</div>
                        <div class="space-y-3">
                            <h3 class="font-bold text-xl text-white uppercase tracking-tight">Finalização</h3>
                            <p class="text-sm text-slate-400 leading-relaxed">
                                Retorne à tela de <b>Configuração</b> deste aplicativo, cole a URL e a Key nos campos correspondentes e clique em <b>"Conectar e Sincronizar"</b>.
                            </p>
                        </div>
                    </section>

                </div>

                <!-- Footer Fixo -->
                <div class="p-6 sm:p-8 border-t border-white/5 bg-white/[0.02] flex flex-col sm:flex-row gap-4 items-center justify-between">
                    <div class="flex items-center gap-2 text-slate-500">
                        <i class="fas fa-shield-halved text-xs"></i>
                        <span class="text-[10px] uppercase font-bold tracking-widest">Configuração Segura & Privada</span>
                    </div>
                    <button onclick="window.closeGuide()" class="w-full sm:w-auto bg-amber-500 text-dark-950 px-10 py-4 rounded-2xl font-black uppercase tracking-widest text-xs transition-all hover:bg-amber-400 hover:-translate-y-1 shadow-xl shadow-amber-500/20 active:scale-95">
                        Concluir e Ir para Configuração
                    </button>
                </div>
            </div>
        </div>
    `;
};
