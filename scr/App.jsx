
import "./styles.css";

const badges = ["Entrega automática", "Suporte rápido", "Compra segura"];

const stats = [
  { value: "4.9/5", label: "Avaliações" },
  { value: "24/7", label: "Entrega rápida" },
  { value: "100%", label: "Compra segura" },
];

const categories = [
  { title: "Games", emoji: "🎮" },
  { title: "Assinaturas", emoji: "📺" },
  { title: "Steam Keys", emoji: "🗝️" },
  { title: "IA's", emoji: "🧠" },
];

const products = [
  { name: "Conta Fortnite FA", tag: "Mais vendida", price: "R$ 29,90", stock: "12 em estoque" },
  { name: "Netflix Premium", tag: "Novo", price: "R$ 12,90", stock: "Disponível" },
  { name: "Steam Key Aleatória", tag: "Barato", price: "R$ 7,90", stock: "21 em estoque" },
  { name: "Discord Nitro", tag: "Popular", price: "R$ 14,90", stock: "8 em estoque" },
];

function Logo({ small = false }) {
  return (
    <div className={small ? "logo logo-small" : "logo"}>
      <svg viewBox="0 0 980 220" className="logo-svg" role="img" aria-label="Blackouts logo">
        <defs>
          <linearGradient id="logoFill" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#eef8ff" />
            <stop offset="35%" stopColor="#9bdcff" />
            <stop offset="70%" stopColor="#47a8ff" />
            <stop offset="100%" stopColor="#1d4ed8" />
          </linearGradient>
          <filter id="logoGlow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="12" result="blur" />
          </filter>
        </defs>

        <rect x="70" y="93" width="840" height="6" rx="3" fill="#3b82f6" opacity="0.95" />
        <g filter="url(#logoGlow)">
          <text
            x="490"
            y="140"
            textAnchor="middle"
            fontSize="102"
            fontWeight="900"
            letterSpacing="5"
            fontFamily="Arial Black, Arial, sans-serif"
            fill="#60a5fa"
          >
            BLACKOUTS
          </text>
        </g>
        <text
          x="490"
          y="140"
          textAnchor="middle"
          fontSize="102"
          fontWeight="900"
          letterSpacing="5"
          fontFamily="Arial Black, Arial, sans-serif"
          fill="url(#logoFill)"
          stroke="#1e40af"
          strokeWidth="3"
          paintOrder="stroke"
        >
          BLACKOUTS
        </text>
      </svg>
    </div>
  );
}

export default function App() {
  return (
    <div className="page">
      <div className="bg-orb bg-orb-top" />
      <div className="bg-orb bg-orb-center" />
      <div className="bg-orb bg-orb-bottom" />

      <header className="site-header">
        <div className="container header-inner">
          <Logo small />
          <nav className="nav">
            <a href="#categorias">Categorias</a>
            <a href="#produtos">Destaques</a>
            <a href="#suporte">Suporte</a>
          </nav>
          <button className="ghost-button">Entrar</button>
        </div>
      </header>

      <main className="container main-content">
        <section className="hero-card">
          <div className="hero-logo-wrap">
            <Logo />
          </div>

          <h1 className="hero-title">A sua vitrine digital premium</h1>

          <div className="badge-row">
            {badges.map((badge) => (
              <span key={badge} className="hero-badge">
                {badge}
              </span>
            ))}
          </div>

          <div className="hero-action">
            <button className="primary-button">Ver produtos</button>
          </div>

          <div className="stats-grid">
            {stats.map((item) => (
              <div key={item.label} className="stat-card">
                <div className="stat-value">{item.value}</div>
                <div className="stat-label">{item.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section id="categorias" className="section-block">
          <div className="section-head center">
            <h2>Categorias</h2>
            <p>Explore as categorias disponíveis na loja.</p>
          </div>

          <div className="category-grid">
            {categories.map((category) => (
              <div key={category.title} className="category-card">
                <div className="category-icon">{category.emoji}</div>
                <h3>{category.title}</h3>
              </div>
            ))}
          </div>
        </section>

        <section id="produtos" className="section-block">
          <div className="section-head">
            <h2>Destaques</h2>
            <p>Produtos em destaque com entrega automática.</p>
          </div>

          <div className="product-grid">
            {products.map((item, index) => (
              <article key={item.name} className="product-card">
                <div className="product-banner">
                  <span className="product-tag">{item.tag}</span>
                  <span className="product-number">{index + 1}</span>
                </div>
                <div className="product-body">
                  <h3>{item.name}</h3>
                  <div className="product-price">{item.price}</div>
                  <div className="product-stock">{item.stock}</div>
                  <button className="buy-button">Comprar</button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="suporte" className="section-block support-grid">
          <div className="support-card">
            <span className="section-label">Suporte</span>
            <h2>Atendimento direto no Discord</h2>
            <p>
              Tire dúvidas, fale com o suporte e acompanhe novidades da loja em um só lugar.
            </p>
            <a className="discord-button" href="https://discord.gg/AsU5pVS7Hn" target="_blank" rel="noreferrer">
              Entrar no Discord
            </a>
          </div>

          <div className="support-card compact">
            <h3>Rápido e seguro</h3>
            <div className="mini-metrics">
              <div className="mini-metric">
                <strong>4.9/5</strong>
                <span>Avaliações</span>
              </div>
              <div className="mini-metric">
                <strong>24/7</strong>
                <span>Suporte rápido</span>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
