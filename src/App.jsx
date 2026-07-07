import { useState, useEffect, useRef, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Link, useLocation, useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ShoppingBag, Menu, X, ArrowRight, ArrowLeft, Minus, Plus, ChevronRight, ChevronLeft, CheckCircle, Loader, Package, Truck, Eye, LogOut, Lock, Mail, Clock, Search } from 'lucide-react';
import { supabase } from './lib/supabase';

/* ═══ PRODUCTS CONTEXT — merges Fulfill Engine + Printify + Shopify ═══ */
const ProductsContext = createContext();

function ProductsProvider({ children }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customCategories, setCustomCategories] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch('/api/products').then(r => r.json()).catch(() => ({ products: [] })),
      fetch('/api/admin/categories').then(r => r.json()).catch(() => ({})),
      fetch('/api/printify/products').then(r => r.json()).catch(() => ({ products: [] })),
      fetch('/api/shopify/products').then(r => r.json()).catch(() => ({ products: [] })),
      fetch('/api/admin/content').then(r => r.json()).catch(() => ({ overrides: {}, customProducts: [] })),
    ]).then(([prodData, catData, pfData, shData, contentData]) => {
      const hidden = new Set(catData.hiddenProductIds || []);
      const overrides = contentData.overrides || {};
      const feProducts = (prodData.products || []).map(p => ({ ...p, source: p.source || 'fulfillengine' }));
      const pfProducts = (pfData.products || []);
      const shProducts = (shData.products || []);
      const customProducts = (contentData.customProducts || []);
      let allProducts = [...feProducts, ...pfProducts, ...shProducts, ...customProducts].filter(p => !hidden.has(p.id));

      // Apply admin overrides — swap in uploaded mockups / name / price.
      allProducts = allProducts.map(p => {
        const ov = overrides[p.id];
        if (!ov) return p;
        const next = { ...p };
        if (Array.isArray(ov.image_urls) && ov.image_urls.length) {
          const imgs = ov.image_urls.map(url => ({ url, zoom: url, thumbnail: url, type: 'custom' }));
          next.image = imgs[0].url; // uploaded mockup leads the card
          // Keep the original photos — show uploaded mockups first, then the originals.
          const origImages = p.colors?.[0]?.images || [];
          next.colors = (p.colors || []).length
            ? [{ ...p.colors[0], images: [...imgs, ...origImages] }, ...p.colors.slice(1)]
            : [{ name: 'Default', hex: '#0A0A0A', images: imgs }];
        }
        if (ov.name) next.name = ov.name;
        if (ov.price != null) { next.price = ov.price; next.basePrice = ov.price; }
        return next;
      });

      // Attach custom categories to each product
      const assignMap = new Map();
      const catById = new Map((catData.categories || []).map(c => [c.id, c.name]));
      for (const a of (catData.assignments || [])) {
        const name = catById.get(a.category_id);
        if (!name) continue;
        const cur = assignMap.get(a.product_id) || [];
        cur.push(name);
        assignMap.set(a.product_id, cur);
      }
      allProducts.forEach(p => { p.customCategories = assignMap.get(p.id) || []; });

      setProducts(allProducts);
      setCategories(prodData.categories || []);
      setCustomCategories(catData.categories || []);
    }).catch(err => console.error('Failed to load products:', err))
      .finally(() => setLoading(false));
  }, []);

  return (
    <ProductsContext.Provider value={{ products, categories, customCategories, loading }}>
      {children}
    </ProductsContext.Provider>
  );
}

function useProducts() { return useContext(ProductsContext); }

/* ═══ AUTH CONTEXT ═══ */
const AuthContext = createContext();

function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user || null);
      setLoading(false);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user || null);
    });
    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => { await supabase.auth.signOut(); setUser(null); };

  return (
    <AuthContext.Provider value={{ user, loading, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

function useAuth() { return useContext(AuthContext); }

function RequireAuth({ children }) {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (!loading && !user) navigate('/account', { replace: true });
  }, [user, loading, navigate]);
  if (loading) return <div style={{ padding: '200px 0', textAlign: 'center' }}><Loader size={24} className="spin" /></div>;
  return user ? children : null;
}

const CartContext = createContext();

function CartProvider({ children }) {
  const { user } = useAuth();
  const [cart, setCart] = useState(() => {
    try { return JSON.parse(localStorage.getItem('shift-cart')) || []; } catch { return []; }
  });
  const [cartOpen, setCartOpen] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);

  useEffect(() => {
    localStorage.setItem('shift-cart', JSON.stringify(cart));
  }, [cart]);

  const addToCart = (product, color, size, image, sizeSurcharge = 0) => {
    const key = `${product.id}-${color}-${size}`;
    const price = product.price + sizeSurcharge;
    // For Printify products, resolve the chosen color+size to its variant_id
    // so the webhook can submit the order to Printify for production.
    const printifyVariantId = product.variantMap?.[`${color}|${size}`] ?? null;
    setCart(prev => {
      const existing = prev.find(i => i.key === key);
      if (existing) return prev.map(i => i.key === key ? { ...i, qty: i.qty + 1 } : i);
      return [...prev, { key, product, color, size, image, price, qty: 1, printifyVariantId }];
    });
    setCartOpen(true);
  };

  const updateQty = (key, delta) => {
    setCart(prev => prev.map(i => i.key === key ? { ...i, qty: Math.max(0, i.qty + delta) } : i).filter(i => i.qty > 0));
  };

  const clearCart = () => { setCart([]); localStorage.removeItem('shift-cart'); };

  const cartCount = cart.reduce((sum, i) => sum + i.qty, 0);
  const cartTotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);

  const checkout = async () => {
    if (cart.length === 0 || checkingOut) return;
    setCheckingOut(true);
    try {
      const res = await fetch('/api/create-checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: cart.map(i => ({
            productId: i.product.id,
            name: i.product.name,
            price: i.price,
            qty: i.qty,
            color: i.color,
            size: i.size,
            image: i.image,
            source: i.product.source || 'static',
            printifyProductId: i.product.printifyProductId || '',
            printifyVariantId: i.printifyVariantId || 0,
          })),
          shipping: 10,
          customerEmail: user?.email || '',
        }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      } else {
        console.error('Checkout error:', data.error);
        setCheckingOut(false);
      }
    } catch (err) {
      console.error('Checkout error:', err);
      setCheckingOut(false);
    }
  };

  return (
    <CartContext.Provider value={{ cart, cartOpen, setCartOpen, addToCart, updateQty, clearCart, cartCount, cartTotal, checkout, checkingOut }}>
      {children}
    </CartContext.Provider>
  );
}

function useCart() { return useContext(CartContext); }

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
}

function GlitchText({ children, tag: Tag = 'span', className = '' }) {
  return (
    <Tag className={`glitch ${className}`} data-text={children}>
      {children}
    </Tag>
  );
}

function Ticker() {
  const items = [
    'Life Keeps Moving', 'Oversized Fit', 'Limited Drops', 'Forward Only',
    'No Reverse', 'Shift Your Perspective',
  ];

  return (
    <div className="ticker">
      <div className="ticker-track">
        {[...Array(3)].map((_, rep) =>
          items.map((item, i) => (
            <span className="ticker-text" key={`${rep}-${i}`}>
              {item}
              <span className="ticker-dot" />
            </span>
          ))
        )}
      </div>
    </div>
  );
}

function Marquee({ children }) {
  return (
    <div className="marquee">
      <div className="marquee-track">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="marquee-item">{children}</div>
        ))}
      </div>
    </div>
  );
}

function Header() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { setCartOpen, cartCount } = useCart();
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 50);
    window.addEventListener('scroll', onScroll);
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => { setMobileOpen(false); }, [location]);

  return (
    <>
      <header className={`header ${scrolled ? 'scrolled' : ''}`}>
        <div className="header-inner">
          <Link to="/" className="header-logo">
            <img src="/shift-logo.png" alt="Shift" className="header-logo-img" />
          </Link>
          <nav className="header-nav">
            <Link to="/shop">Shop</Link>
            <Link to="/collections">Collections</Link>
            <Link to="/about">About</Link>
            <Link to="/account">Account</Link>
          </nav>
          <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
            <button className="header-cart" onClick={() => setCartOpen(true)}>
              <ShoppingBag size={20} />
              {cartCount > 0 && <span className="cart-badge">{cartCount}</span>}
            </button>
            <button className="mobile-toggle" onClick={() => setMobileOpen(true)}>
              <Menu size={24} />
            </button>
          </div>
        </div>
      </header>

      <div className={`mobile-nav ${mobileOpen ? 'open' : ''}`}>
        <button className="mobile-nav-close" onClick={() => setMobileOpen(false)}>
          <X size={28} />
        </button>
        <Link to="/" onClick={() => setMobileOpen(false)}>Home</Link>
        <Link to="/shop" onClick={() => setMobileOpen(false)}>Shop</Link>
        <Link to="/collections" onClick={() => setMobileOpen(false)}>Collections</Link>
        <Link to="/about" onClick={() => setMobileOpen(false)}>About</Link>
        <Link to="/account" onClick={() => setMobileOpen(false)}>Account</Link>
      </div>
    </>
  );
}

function CartDrawer() {
  const { cart, cartOpen, setCartOpen, updateQty, cartTotal } = useCart();
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <>
      <div className={`cart-overlay ${cartOpen ? 'open' : ''}`} onClick={() => setCartOpen(false)} />
      <div className={`cart-drawer ${cartOpen ? 'open' : ''}`}>
        <div className="cart-header">
          <span className="cart-title">Cart ({cart.length})</span>
          <button onClick={() => setCartOpen(false)}><X size={20} /></button>
        </div>

        {cart.length === 0 ? (
          <div className="cart-empty">
            <ShoppingBag size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>Your cart is empty</p>
          </div>
        ) : (
          <>
            <div className="cart-items">
              {cart.map(item => (
                <div key={item.key} className="cart-item">
                  <img className="cart-item-img" src={item.image || item.product.image} alt={item.product.name} />
                  <div className="cart-item-info">
                    <div className="cart-item-name">{item.product.name}</div>
                    <div className="cart-item-variant">{item.color} / {item.size}</div>
                    <div className="cart-item-price">${item.price.toFixed(2)}</div>
                    <div className="cart-qty">
                      <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                      <span>{item.qty}</span>
                      <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <div className="cart-footer">
              <div className="cart-total">
                <span>Subtotal</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <div style={{ fontSize: 12, color: 'var(--gray)', marginBottom: 12 }}>Shipping calculated at checkout</div>
              {user ? (
                <button className="checkout-btn" onClick={() => { setCartOpen(false); navigate('/checkout'); }}>
                  Checkout <ArrowRight size={14} />
                </button>
              ) : (
                <button className="checkout-btn" onClick={() => { setCartOpen(false); navigate('/account'); }}>
                  Sign In to Checkout <ArrowRight size={14} />
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </>
  );
}

function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <img src="/shift-logo.png" alt="Shift" className="footer-logo-img" />
          <p className="footer-desc">
            Your Mindset. Your Focus. Your Perspective. Life keeps moving — and so do we.
          </p>
        </div>
        <div className="footer-col">
          <h4>Shop</h4>
          <Link to="/shop">All Products</Link>
          <Link to="/shop">Tees</Link>
          <Link to="/shop">Hoodies</Link>
          <Link to="/shop">Crewnecks</Link>
          <Link to="/shop">Headwear</Link>
        </div>
        <div className="footer-col">
          <h4>Company</h4>
          <Link to="/about">About</Link>
          <Link to="/collections">Collections</Link>
        </div>
        <div className="footer-col">
          <h4>Info</h4>
          <a href="#">Shipping</a>
          <a href="#">Returns</a>
          <a href="#">Privacy</a>
          <a href="#">Terms</a>
        </div>
      </div>
      <div className="footer-bottom">
        <span>&copy; {new Date().getFullYear()} Shift. All rights reserved.</span>
        <span style={{ color: 'var(--red)' }}>Life Keeps Moving &rarr;</span>
      </div>
    </footer>
  );
}

function ProductCard({ product, index }) {
  const navigate = useNavigate();
  return (
    <motion.div
      className="product-card"
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.5, delay: index * 0.06 }}
      onClick={() => navigate(`/product/${product.id}`)}
    >
      <div className="glitch-img-wrap">
        <img
          className="product-card-img"
          src={product.image}
          alt={product.name}
          loading="lazy"
        />
      </div>
      {product.badge && <div className="product-card-badge">{product.badge}</div>}
      <div className="product-card-name">{product.name}</div>
      <div className="product-card-price">
        {product.comparePrice && (
          <span style={{ textDecoration: 'line-through', color: 'var(--gray)', marginRight: 8 }}>${product.comparePrice}</span>
        )}
        ${product.price}
      </div>
    </motion.div>
  );
}

function ProductCarousel({ products: items }) {
  const trackRef = useRef(null);
  const [page, setPage] = useState(0);
  const [pages, setPages] = useState(1);
  const navigate = useNavigate();

  // Recompute how many horizontal "pages" the two-row track spans.
  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const update = () => setPages(Math.max(1, Math.ceil((track.scrollWidth - 4) / track.clientWidth)));
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [items.length]);

  const scroll = (dir) => {
    const track = trackRef.current;
    if (!track) return;
    const next = Math.max(0, Math.min(page + dir, pages - 1));
    track.scrollTo({ left: track.clientWidth * next, behavior: 'smooth' });
    setPage(next);
  };

  const onScroll = () => {
    const track = trackRef.current;
    if (!track) return;
    setPage(Math.round(track.scrollLeft / track.clientWidth));
  };

  return (
    <div className="carousel">
      <div className="carousel-viewfinder">
        <div className="vf-corner vf-tl" />
        <div className="vf-corner vf-tr" />
        <div className="vf-corner vf-bl" />
        <div className="vf-corner vf-br" />
        <div className="carousel-counter">
          <span className="carousel-counter-current">{String(page + 1).padStart(2, '0')}</span>
          <span className="carousel-counter-sep">/</span>
          <span className="carousel-counter-total">{String(pages).padStart(2, '0')}</span>
        </div>
      </div>

      <div className="carousel-track two-row" ref={trackRef} onScroll={onScroll}>
        {items.map((p) => (
          <div
            key={p.id}
            className="carousel-slide"
            onClick={() => navigate(`/product/${p.id}`)}
          >
            <div className="carousel-slide-img glitch-img-wrap">
              <img src={p.image} alt={p.name} loading="lazy" />
              {p.badge && <div className="carousel-badge">{p.badge}</div>}
            </div>
            <div className="carousel-slide-info">
              <div className="carousel-slide-name">{p.name}</div>
              <div className="carousel-slide-price">${p.price}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="carousel-nav">
        <button className="carousel-btn" onClick={() => scroll(-1)} disabled={page === 0}>
          <ArrowLeft size={18} />
        </button>
        <div className="carousel-dots">
          {Array.from({ length: pages }).map((_, i) => (
            <div key={i} className={`carousel-dot ${i === page ? 'active' : ''}`} onClick={() => scroll(i - page)} />
          ))}
        </div>
        <button className="carousel-btn" onClick={() => scroll(1)} disabled={page >= pages - 1}>
          <ArrowRight size={18} />
        </button>
      </div>
    </div>
  );
}

/* ═══ PAGES ═══ */

function HomePage() {
  const { products, customCategories } = useProducts();
  const featured = products.slice(0, 12);
  const categoryTiles = (customCategories || []).filter(c => c.image_url);
  const [heroLoaded, setHeroLoaded] = useState(false);

  return (
    <>
      {/* SCANLINES */}
      <div className="scanlines" />

      {/* HERO */}
      <section className="hero">
        <div className="hero-media">
          <img src="/lifestyle/street-crossing.png" alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          <video
            src="/videos/shift-hero.mp4"
            autoPlay muted loop playsInline
            onLoadedData={() => setHeroLoaded(true)}
            style={{ position: 'absolute', inset: 0, opacity: heroLoaded ? 1 : 0, width: '100%', height: '100%', objectFit: 'cover', transition: 'opacity 1s' }}
          />
          <div className="hero-gradient" />
          <div className="hero-scanline" />
        </div>
        <motion.div
          className="hero-inner"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, delay: 0.3 }}
        >
          <img src="/shift-logo.png" alt="Shift" className="hero-logo-img" />
          <div className="hero-tagline">Life Keeps Moving</div>
          <Link to="/shop" className="hero-cta">
            Shop Now <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* TICKER */}
      <Ticker />

      {/* GLITCH MARQUEE */}
      <Marquee>
        <span className="filled">SHIFT</span> <span>&rarr;</span> <span className="red">FORWARD</span> <span>&rarr;</span> <span>ONLY</span> <span>&rarr;</span>
      </Marquee>

      {/* INTRO */}
      <motion.section
        className="intro"
        initial={{ opacity: 0, y: 30 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <div className="intro-label">The Brand</div>
        <h2 className="intro-headline">
          <GlitchText>More than apparel. A mindset.</GlitchText>
        </h2>
        <p className="intro-body">
          Every piece carries the energy of forward motion. Heavyweight, premium, built to last — designed for people who move with intention. The arrow only points one direction.
        </p>
      </motion.section>

      {/* SPREAD — Essentials */}
      <section className="spread">
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/creator.jpg" alt="Meet the creator — SHIFT" loading="lazy" style={{ objectPosition: 'center 30%' }} />
        </div>
        <motion.div
          className="spread-text"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <h2 className="spread-title"><GlitchText>Meet the Creator</GlitchText></h2>
          <p className="spread-body">
            The heart of this brand is the belief that life's unexpected turns are opportunities to shift, adapt, and move forward. SHIFT was inspired by my own challenges and pivot points in life — knowing growth comes from change. We're here to encourage you to move with purpose, embrace new paths, and ALWAYS keep moving forward. Life keeps moving, so should you.
          </p>
          <Link to="/about" className="spread-link">
            View the Mission <ArrowRight size={14} />
          </Link>
        </motion.div>
      </section>

      {/* PULLQUOTE */}
      <motion.section
        className="pullquote"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
      >
        <p className="pullquote-text">
          "The arrow only points one direction — <em>forward</em>."
        </p>
      </motion.section>

      {/* PRODUCTS — Camera Roll Carousel */}
      <section className="products-section">
        <div className="products-header">
          <h2 className="products-title">The Collection</h2>
          <Link to="/shop" className="products-link">
            View All <ArrowRight size={14} />
          </Link>
        </div>
        <ProductCarousel products={featured} />
      </section>

      {/* SHOP BY CATEGORY */}
      {categoryTiles.length > 0 && (
        <section className="category-section">
          <div className="products-header">
            <h2 className="products-title">Shop by Category</h2>
            <Link to="/shop" className="products-link">View All <ArrowRight size={14} /></Link>
          </div>
          <div className="category-grid">
            {categoryTiles.map(cat => (
              <Link
                key={cat.id}
                to={`/shop?category=${encodeURIComponent(cat.name)}`}
                className="category-tile glitch-img-wrap"
              >
                <img src={cat.image_url} alt={cat.name} loading="lazy" />
                <div className="category-tile-overlay">
                  <span className="category-tile-name">{cat.name}</span>
                  <span className="category-tile-cta">Shop <ArrowRight size={12} /></span>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      {/* MARQUEE 2 */}
      <Marquee>
        <span className="red">NO REVERSE</span> <span>&rarr;</span> <span className="filled">KEEP MOVING</span> <span>&rarr;</span> <span>SHIFT</span> <span>&rarr;</span>
      </Marquee>

      {/* PHOTO GRID */}
      <div className="photo-grid">
        <div className="photo-grid-item tall glitch-img-wrap">
          <img src="/lifestyle/shift-walk.jpg" alt="Shift — life keeps moving" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-convertible.jpg" alt="Shift NYC convertible" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-caps.jpg" alt="Shift caps in SoHo" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-alley.jpg" alt="Shift hoodies" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/shift-skate.jpg" alt="Shift skate" loading="lazy" />
        </div>
      </div>

      {/* DARK SECTION — Racing */}
      <section className="dark-section">
        <div className="spread spread-reverse" style={{ minHeight: 'auto' }}>
          <motion.div
            className="spread-text"
            style={{ background: 'var(--bg-raised)' }}
            initial={{ opacity: 0, x: -40 }}
            whileInView={{ opacity: 1, x: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
          >
            <div className="spread-label">Our Staples</div>
            <h2 className="spread-title"><GlitchText>The "OG" Collection</GlitchText></h2>
            <p className="spread-body">
              Vintage acid wash. Cool Graphics. Built for those who know that life keeps moving — and so should we.
            </p>
            <Link to="/shop" className="spread-link">
              Shop Staples <ArrowRight size={14} />
            </Link>
          </motion.div>
          <div className="spread-img glitch-img-wrap">
            <video src="/videos/shift-racing.mp4" autoPlay muted loop playsInline style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </div>
        </div>
      </section>


      {/* NEWSLETTER */}
      <section className="newsletter">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="newsletter-label">Stay Locked In</div>
          <h3 className="newsletter-title"><GlitchText>Join the Movement</GlitchText></h3>
          <p className="newsletter-sub">Early access to drops, exclusive colorways, and first dibs on limited editions.</p>
          <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
            <input type="email" placeholder="Your email" />
            <button type="submit">Subscribe</button>
          </form>
        </motion.div>
      </section>
    </>
  );
}

function ShopPage() {
  const { products, categories, customCategories, loading } = useProducts();
  const [searchParams] = useSearchParams();
  const [activeFilter, setActiveFilter] = useState('all');

  // Preselect a category when arriving from a homepage tile (?category=Name).
  useEffect(() => {
    const cat = searchParams.get('category');
    if (cat) setActiveFilter(cat);
  }, [searchParams]);

  // Use custom categories if available, fall back to FE categories
  const hasCustom = customCategories.length > 0;
  const filters = hasCustom
    ? [{ id: 'all', name: 'All' }, ...customCategories.map(c => ({ id: c.name, name: c.name, image_url: c.image_url }))]
    : [{ id: 'all', name: 'All' }, ...categories.map(c => ({ id: c.id || c.name, name: c.name }))];
  const usePhotoTiles = hasCustom && customCategories.some(c => c.image_url);

  // Spread the "All" grid so same-category items aren't clustered together
  // (e.g. not 3 hats in a row). Deterministic round-robin: deal one product
  // from each category in rotation, preserving each category's internal order.
  const spreadProducts = (list) => {
    const groups = new Map();
    for (const p of list) {
      const key = (p.customCategories && p.customCategories[0]) || p.category || p.source || 'other';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(p);
    }
    const buckets = [...groups.values()];
    const out = [];
    for (let round = 0; out.length < list.length; round++) {
      let progressed = false;
      for (const b of buckets) {
        if (round < b.length) { out.push(b[round]); progressed = true; }
      }
      if (!progressed) break;
    }
    return out;
  };

  const filtered = activeFilter === 'all'
    ? spreadProducts(products)
    : hasCustom
      ? products.filter(p => (p.customCategories || []).includes(activeFilter))
      : products.filter(p => p.category === activeFilter);

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Shop All</GlitchText></h1>
          {filters.length > 1 && (
            usePhotoTiles ? (
              <div className="shop-cat-tiles">
                {filters.map(c => (
                  <button
                    key={c.id}
                    className={`shop-cat-tile ${activeFilter === c.id ? 'active' : ''} ${c.image_url ? 'has-photo' : ''}`}
                    onClick={() => setActiveFilter(c.id)}
                    style={c.image_url ? { backgroundImage: `linear-gradient(rgba(10,10,10,.35), rgba(10,10,10,.65)), url(${c.image_url})` } : {}}
                  >
                    <span>{c.name}</span>
                  </button>
                ))}
              </div>
            ) : (
              <div className="shop-filters">
                {filters.map(c => (
                  <button
                    key={c.id}
                    className={`filter-btn ${activeFilter === c.id ? 'active' : ''}`}
                    onClick={() => setActiveFilter(c.id)}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            )
          )}
        </motion.div>
      </div>
      {loading ? (
        <div style={{ textAlign: 'center', padding: '100px 0', color: 'var(--gray)' }}>
          <Loader size={24} className="spin" />
          <p style={{ marginTop: 16 }}>Loading products...</p>
        </div>
      ) : (
        <div className="shop-grid">
          {filtered.map((p, i) => (
            <ProductCard key={p.id} product={p} index={i} />
          ))}
        </div>
      )}
    </>
  );
}

function ProductPage() {
  const { id } = useParams();
  const { products, loading } = useProducts();
  const product = products.find(p => p.id === id);
  const [selectedColor, setSelectedColor] = useState(0);
  const [selectedSize, setSelectedSize] = useState(null);
  const { addToCart } = useCart();

  if (loading) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}><Loader size={24} className="spin" /></div>;
  if (!product) return <div style={{ padding: '200px 40px', textAlign: 'center', color: 'var(--gray)' }}>Product not found</div>;

  const currentColor = product.colors[selectedColor] || product.colors[0];
  const currentImages = currentColor?.images || [];
  const mainImage = currentImages[0]?.url || product.image;
  const selectedSizeObj = product.sizes.find(s => s.name === selectedSize);
  const totalPrice = product.price + (selectedSizeObj?.surcharge || 0);

  const handleAdd = () => {
    if (!selectedSize) return;
    addToCart(product, currentColor.name, selectedSize, mainImage, selectedSizeObj?.surcharge || 0);
  };

  return (
    <div className="pdp">
      <div className="scanlines" />
      <div className="pdp-layout">
        <div className="pdp-gallery">
          {currentImages.map((img, i) => (
            <div key={i} className="glitch-img-wrap">
              <img className="pdp-gallery-img" src={img.url} alt={`${product.name} ${img.type}`} />
            </div>
          ))}
          {currentImages.length === 0 && (
            <div className="glitch-img-wrap">
              <img className="pdp-gallery-img" src={product.image} alt={product.name} />
            </div>
          )}
        </div>

        <motion.div
          className="pdp-info"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.6 }}
        >
          <div className="pdp-breadcrumb">
            <Link to="/shop">Shop</Link> <ChevronRight size={10} style={{ margin: '0 6px' }} /> {product.name}
          </div>

          <h1 className="pdp-name">{product.name}</h1>
          <div className="pdp-price">${totalPrice.toFixed(2)}</div>
          <p className="pdp-desc">{product.description}</p>

          {product.colors.length > 1 && (
            <>
              <div className="pdp-label">Color — {currentColor.name}</div>
              <div className="color-options">
                {product.colors.map((c, i) => (
                  <button
                    key={c.name}
                    className={`color-swatch ${selectedColor === i ? 'active' : ''}`}
                    style={{ background: c.hex }}
                    onClick={() => setSelectedColor(i)}
                  />
                ))}
              </div>
            </>
          )}

          {product.sizes.length > 0 && (
            <>
              <div className="pdp-label">Size</div>
              <div className="size-options">
                {product.sizes.map(s => (
                  <button
                    key={s.name}
                    className={`size-btn ${selectedSize === s.name ? 'active' : ''}`}
                    onClick={() => setSelectedSize(s.name)}
                  >
                    {s.name}{s.surcharge > 0 ? ` (+$${s.surcharge.toFixed(2)})` : ''}
                  </button>
                ))}
              </div>
            </>
          )}

          <button className="add-btn" onClick={handleAdd} style={{ opacity: (selectedSize || product.sizes.length === 0) ? 1 : 0.5 }}>
            {(selectedSize || product.sizes.length === 0) ? 'Add to Cart' : 'Select a Size'} <ArrowRight size={14} />
          </button>
        </motion.div>
      </div>
    </div>
  );
}

function CollectionsPage() {
  const { products, customCategories } = useProducts();
  const rots = [-3, 2.5, -1.5, 4, -2, 3, -2.5, 1.5, -3.5, 2];

  // Build the board from the store's real categories (managed in the admin).
  const catBoards = (customCategories || []).map((c, i) => {
    const inCat = products.filter(p => (p.customCategories || []).includes(c.name));
    const img = c.image_url || inCat[0]?.image || inCat[0]?.colors?.[0]?.images?.[0]?.url || '';
    return {
      title: c.name,
      img,
      label: `${inCat.length} ${inCat.length === 1 ? 'piece' : 'pieces'}`,
      to: `/shop?category=${encodeURIComponent(c.name)}`,
      rot: rots[i % rots.length],
    };
  });

  // Fallback editorial boards only if no categories exist yet.
  const fallbackBoards = [
    { img: '/lifestyle/pizza-shop.png', label: 'Core', title: 'Essentials', to: '/shop', rot: -3 },
    { img: '/lifestyle/car-meet.png', label: 'Limited', title: 'Racing', to: '/shop', rot: 2.5 },
    { img: '/lifestyle/convertible-pink-red.png', label: 'New', title: 'Fresh Drops', to: '/shop', rot: -1.5 },
    { img: '/lifestyle/subway.png', label: 'Vintage', title: 'City Series', to: '/shop', rot: 4 },
    { img: '/lifestyle/chinatown.jpg', label: 'Street', title: 'Chinatown', to: '/shop', rot: -2 },
    { img: '/lifestyle/nyc-crosswalk.png', label: 'Lifestyle', title: 'NYC', to: '/shop', rot: 3 },
  ];

  const boards = catBoards.length > 0 ? catBoards : fallbackBoards;

  return (
    <>
      <div className="scanlines" />
      <div className="shop-header">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <h1 className="shop-title"><GlitchText>Collections</GlitchText></h1>
          <p style={{ fontSize: 15, color: 'var(--gray)', marginTop: 12 }}>Shop by category. Each one tells a story.</p>
        </motion.div>
      </div>

      <div className="board">
        <div className="board-inner">
          {boards.map((b, i) => (
            <Link
              to={b.to}
              key={b.title + i}
              className="pin-card"
              style={{
                '--rot': `${b.rot}deg`,
                '--delay': `${i * 0.4}s`,
              }}
            >
              <div className="pin" />
              <div className="pin-shadow" />
              <div className="pin-photo">
                {b.img
                  ? <img src={b.img} alt={b.title} loading="lazy" />
                  : <div className="pin-photo-empty"><span>{b.title}</span></div>}
              </div>
              <div className="pin-label">
                <span className="pin-label-tag">{b.label}</span>
                <span className="pin-label-title">{b.title}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>

      <section className="newsletter" style={{ marginTop: 40 }}>
        <div className="newsletter-label">Be First</div>
        <h3 className="newsletter-title"><GlitchText>Get Notified</GlitchText></h3>
        <p className="newsletter-sub">Be the first to know when new collections drop.</p>
        <form className="newsletter-form" onSubmit={e => e.preventDefault()}>
          <input type="email" placeholder="Your email" />
          <button type="submit">Notify Me</button>
        </form>
      </section>
    </>
  );
}

function AboutPage() {
  return (
    <>
      <div className="scanlines" />
      <div className="shop-header" style={{ paddingBottom: 0 }}>
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--red)', marginBottom: 16 }}>The Story</div>
          <h1 className="shop-title"><GlitchText>Life Keeps Moving</GlitchText></h1>
        </motion.div>
      </div>

      <motion.section
        className="intro"
        initial={{ opacity: 0 }}
        whileInView={{ opacity: 1 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        style={{ paddingTop: 60 }}
      >
        <p className="intro-body">
          Shift was born from a simple truth: life doesn't wait. The arrow in our logo only points one direction — forward. There is no reverse, no pause button, no going back.
        </p>
        <p className="intro-body" style={{ marginTop: 24 }}>
          We make clothes for people who move. Not just physically, but mentally. People who are shifting their mindset, sharpening their focus, and changing their perspective on what's possible.
        </p>
        <p className="intro-body" style={{ marginTop: 24 }}>
          Every piece we create carries that energy. Heavyweight, premium, built to last — because the journey doesn't end after one wear. Our designs are rooted in movement: roads, speed, direction, purpose.
        </p>
      </motion.section>

      <div className="pullquote">
        <p className="pullquote-text">
          "This isn't just streetwear. It's a daily reminder. Shift your mindset. Shift your focus. Shift your perspective. <em>And keep moving forward.</em>"
        </p>
      </div>

      <section className="spread">
        <div className="spread-img glitch-img-wrap">
          <img src="/lifestyle/convertible-pink-red.png" alt="Shift lifestyle" loading="lazy" />
        </div>
        <div className="spread-text" style={{ alignItems: 'center', textAlign: 'center' }}>
          <img src="/shift-logo.png" alt="Shift" style={{ width: 200, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
          <p style={{ fontSize: 15, color: 'var(--gray)', lineHeight: 1.8 }}>Your Mindset. Your Focus. Your Perspective.</p>
        </div>
      </section>

      <div className="photo-grid">
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/nyc-crosswalk.png" alt="NYC" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/pool-party.png" alt="Pool party" loading="lazy" />
        </div>
        <div className="photo-grid-item glitch-img-wrap">
          <img src="/lifestyle/street-crossing.png" alt="Street" loading="lazy" />
        </div>
      </div>
    </>
  );
}

const FLAT_SHIPPING = 10;

function CheckoutPage() {
  const { cart, updateQty, cartTotal, checkout, checkingOut } = useCart();
  const { products } = useProducts();
  const navigate = useNavigate();
  const [selectedSuggestion, setSelectedSuggestion] = useState(null);

  // Live shipping: real Printify rate for Printify items + flat for others.
  const hasPrintify = cart.some(i => i.product.source === 'printify');
  const hasOther = cart.some(i => (i.product.source || 'static') !== 'printify');
  const [pfShipping, setPfShipping] = useState(null);
  const [shipLoading, setShipLoading] = useState(hasPrintify);

  useEffect(() => {
    if (!hasPrintify) { setPfShipping(0); setShipLoading(false); return; }
    let cancelled = false;
    setShipLoading(true);
    fetch('/api/printify/shipping', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        items: cart.map(i => ({
          source: i.product.source || 'static',
          printifyProductId: i.product.printifyProductId || '',
          printifyVariantId: i.printifyVariantId || 0,
          qty: i.qty,
        })),
      }),
    })
      .then(r => r.json())
      .then(d => { if (!cancelled) setPfShipping(typeof d.shipping === 'number' ? d.shipping : FLAT_SHIPPING); })
      .catch(() => { if (!cancelled) setPfShipping(FLAT_SHIPPING); })
      .finally(() => { if (!cancelled) setShipLoading(false); });
    return () => { cancelled = true; };
  }, [cart, hasPrintify]);

  const shippingTotal = (hasPrintify ? (pfShipping ?? FLAT_SHIPPING) : 0) + (hasOther ? FLAT_SHIPPING : 0);

  const cartProductIds = new Set(cart.map(i => i.product.id));
  const suggestions = products.filter(p => !cartProductIds.has(p.id)).slice(0, 6);

  if (!cart.length) {
    return (
      <>
        <div className="scanlines" />
        <div className="ck-page">
          <div className="ck-empty">
            <ShoppingBag size={40} style={{ opacity: 0.3, marginBottom: 16 }} />
            <h2>Your cart is empty</h2>
            <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex', marginTop: 16 }}>Continue Shopping <ArrowRight size={14} /></Link>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="scanlines" />
      <div className="ck-page">
        <div className="ck-container">
          <div className="ck-left">
            <Link to="/shop" className="ck-back"><ArrowLeft size={14} /> Continue Shopping</Link>
            <h1 className="ck-title"><GlitchText>Checkout</GlitchText></h1>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 32 }}>{cart.length} item{cart.length !== 1 ? 's' : ''} in your bag</p>

            <div className="ck-items">
              {cart.map(item => (
                <div key={item.key} className="ck-item">
                  <img src={item.image || item.product.image} alt={item.product.name} className="ck-item-img" />
                  <div className="ck-item-info">
                    <div className="ck-item-name">{item.product.name}</div>
                    <div className="ck-item-variant">{item.color} / {item.size}</div>
                    <div className="ck-item-price">${item.price.toFixed(2)}</div>
                    <div className="ck-item-actions">
                      <div className="cart-qty">
                        <button onClick={() => updateQty(item.key, -1)}><Minus size={12} /></button>
                        <span>{item.qty}</span>
                        <button onClick={() => updateQty(item.key, 1)}><Plus size={12} /></button>
                      </div>
                      <button className="ck-remove" onClick={() => updateQty(item.key, -item.qty)}>Remove</button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="ck-right">
            <div className="ck-summary">
              <h2 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 20 }}>Order Summary</h2>
              <div className="ck-summary-row">
                <span>Subtotal</span>
                <span>${cartTotal.toFixed(2)}</span>
              </div>
              <div className="ck-summary-row">
                <span>Shipping</span>
                {!hasPrintify
                  ? <span style={{ fontSize: 12, color: 'var(--gray)' }}>Calculated at payment</span>
                  : shipLoading
                    ? <span style={{ fontSize: 12, color: 'var(--gray)' }}>Calculating…</span>
                    : <span>${shippingTotal.toFixed(2)}</span>}
              </div>
              <div className="ck-summary-row ck-summary-total">
                <span>{hasPrintify && !shipLoading ? 'Total' : 'Estimated Total'}</span>
                <span>${(cartTotal + (hasPrintify && !shipLoading ? shippingTotal : 0)).toFixed(2)}</span>
              </div>
              <button className="ck-pay-btn" onClick={checkout} disabled={checkingOut}>
                {checkingOut ? <><Loader size={14} className="spin" /> Processing...</> : <>Pay Now <ArrowRight size={14} /></>}
              </button>
              <p className="ck-secure">
                <Lock size={12} /> Secure checkout. Your payment info is encrypted.
              </p>
            </div>
          </div>
        </div>

        {suggestions.length > 0 && (
          <div className="ck-suggestions">
            <h3 style={{ fontSize: 16, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 8 }}>Add to Your Order</h3>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>Complete the look before you check out.</p>
            <div className="ck-suggestions-grid">
              {suggestions.map(p => (
                <div key={p.id} className="ck-suggestion" onClick={() => navigate(`/product/${p.id}`)}>
                  <img src={p.image} alt={p.name} />
                  <div className="ck-suggestion-name">{p.name}</div>
                  <div className="ck-suggestion-price">${p.price.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}

function OrderSuccessPage() {
  const { clearCart } = useCart();
  const [searchParams] = useSearchParams();
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    if (sessionId) clearCart();
  }, [sessionId]);

  return (
    <>
      <div className="scanlines" />
      <div style={{ minHeight: '60vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '120px 24px 80px', textAlign: 'center' }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.6 }}
        >
          <CheckCircle size={48} style={{ color: 'var(--red)', marginBottom: 24 }} />
          <h1 style={{ fontSize: 'clamp(28px, 5vw, 42px)', fontWeight: 900, textTransform: 'uppercase', marginBottom: 16 }}>
            <GlitchText>Order Confirmed</GlitchText>
          </h1>
          <p style={{ fontSize: 16, color: 'var(--gray)', maxWidth: 480, margin: '0 auto 32px', lineHeight: 1.6 }}>
            Thanks for your order. You'll receive a confirmation email shortly with tracking info once your items ship.
          </p>
          <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex' }}>
            Continue Shopping <ArrowRight size={14} />
          </Link>
        </motion.div>
      </div>
    </>
  );
}

/* ═══ ADMIN DASHBOARD ═══ */


function AdminPage() {
  const [authed, setAuthed] = useState(() => !!sessionStorage.getItem('shift-admin-pw'));
  const [adminPassword, setAdminPassword] = useState(() => sessionStorage.getItem('shift-admin-pw') || '');
  const [draftPassword, setDraftPassword] = useState('');
  const [status, setStatus] = useState('');
  const [loggingIn, setLoggingIn] = useState(false);

  const login = async (e) => {
    e.preventDefault();
    setStatus('');
    setLoggingIn(true);
    try {
      const res = await fetch('/api/admin/orders?status=all', {
        headers: { 'x-admin-key': draftPassword },
      });
      if (!res.ok) throw new Error('Invalid password');
      sessionStorage.setItem('shift-admin-pw', draftPassword);
      setAdminPassword(draftPassword);
      setAuthed(true);
    } catch (err) {
      setStatus(err.message);
    } finally {
      setLoggingIn(false);
    }
  };

  if (!authed) {
    return (
      <div className="admin-login">
        <div className="admin-login-card">
          <img src="/shift-logo.png" alt="Shift" style={{ height: 32, marginBottom: 24 }} />
          <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888', marginBottom: 4 }}>Shift Admin</p>
          <h2>Sign In</h2>
          <form onSubmit={login}>
            <input type="password" placeholder="Admin password" value={draftPassword} onChange={e => setDraftPassword(e.target.value)} />
            <button type="submit" disabled={loggingIn}>
              {loggingIn ? 'Verifying...' : 'Enter Admin'}
            </button>
          </form>
          {status && <p style={{ color: '#e53e3e', fontSize: 13, marginTop: 12 }}>{status}</p>}
        </div>
      </div>
    );
  }

  return <AdminDashboard adminPassword={adminPassword} />;
}

/* ═══ ADMIN PRODUCTS / CATEGORIES ═══ */

function AdminProductsPage({ adminPassword }) {
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [hiddenProductIds, setHiddenProductIds] = useState([]);
  const [selectedCategoryId, setSelectedCategoryId] = useState('');
  const [newCategoryName, setNewCategoryName] = useState('');
  const [categoryNameDraft, setCategoryNameDraft] = useState('');
  const [adminQuery, setAdminQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusMsg, setStatusMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const selectedCategory = categories.find(c => c.id === selectedCategoryId);

  const assignedProductIds = new Set(
    assignments.filter(a => a.category_id === selectedCategoryId).map(a => a.product_id)
  );

  const categoryNamesByProduct = new Map();
  const categoryById = new Map(categories.map(c => [c.id, c.name]));
  for (const a of assignments) {
    const name = categoryById.get(a.category_id);
    if (!name) continue;
    const current = categoryNamesByProduct.get(a.product_id) || [];
    current.push(name);
    categoryNamesByProduct.set(a.product_id, current);
  }

  const hiddenSet = new Set(hiddenProductIds);

  const counts = products.reduce((acc, p) => {
    acc.all++;
    if (categoryNamesByProduct.get(p.id)?.length) acc.categorized++;
    else acc.uncategorized++;
    if (assignedProductIds.has(p.id)) acc.inCategory++;
    return acc;
  }, { all: 0, categorized: 0, uncategorized: 0, inCategory: 0 });

  const visibleProducts = products.filter(p => {
    const q = adminQuery.toLowerCase();
    if (q && !p.name.toLowerCase().includes(q)) return false;
    if (categoryFilter === 'in-category') return assignedProductIds.has(p.id);
    if (categoryFilter === 'categorized') return !!categoryNamesByProduct.get(p.id)?.length;
    if (categoryFilter === 'uncategorized') return !categoryNamesByProduct.get(p.id)?.length;
    return true;
  });

  const loadData = async (selectId) => {
    setLoading(true);
    try {
      const [prodRes, catRes, pfRes, shRes, contentRes] = await Promise.all([
        fetch('/api/products'),
        fetch('/api/admin/categories'),
        fetch('/api/printify/products').catch(() => null),
        fetch('/api/shopify/products').catch(() => null),
        fetch('/api/admin/content').catch(() => null),
      ]);
      const prodData = await prodRes.json();
      const catData = await catRes.json();
      const pfData = pfRes ? await pfRes.json().catch(() => ({ products: [] })) : { products: [] };
      const shData = shRes ? await shRes.json().catch(() => ({ products: [] })) : { products: [] };
      const contentData = contentRes ? await contentRes.json().catch(() => ({ customProducts: [] })) : { customProducts: [] };
      // Show ALL sources in the back end (Fulfill Engine + Printify + Shopify + custom)
      setProducts([
        ...(prodData.products || []),
        ...(pfData.products || []),
        ...(shData.products || []),
        ...(contentData.customProducts || []),
      ]);
      setCategories(catData.categories || []);
      setAssignments(catData.assignments || []);
      setHiddenProductIds(catData.hiddenProductIds || []);
      if (selectId) {
        setSelectedCategoryId(selectId);
        const cat = (catData.categories || []).find(c => c.id === selectId);
        if (cat) setCategoryNameDraft(cat.name);
      }
    } catch (err) {
      setStatusMsg(err.message);
    }
    setLoading(false);
  };

  useEffect(() => { loadData(); }, []);

  const adminFetch = async (action, body = {}) => {
    const res = await fetch('/api/admin/categories', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify({ action, ...body }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  };

  const createCategory = async (e) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    try {
      const data = await adminFetch('createCategory', { name: newCategoryName });
      setNewCategoryName('');
      await loadData(data.category?.id);
      setStatusMsg('Category created');
    } catch (err) { setStatusMsg(err.message); }
  };

  const updateCategory = async (e) => {
    e.preventDefault();
    if (!selectedCategoryId || !categoryNameDraft.trim() || categoryNameDraft.trim() === selectedCategory?.name) return;
    try {
      await adminFetch('updateCategory', { categoryId: selectedCategoryId, name: categoryNameDraft.trim() });
      await loadData(selectedCategoryId);
      setStatusMsg('Category updated');
    } catch (err) { setStatusMsg(err.message); }
  };

  const deleteCategory = async () => {
    if (!selectedCategoryId || !confirm('Delete this category?')) return;
    try {
      await adminFetch('deleteCategory', { categoryId: selectedCategoryId });
      setSelectedCategoryId('');
      setCategoryNameDraft('');
      await loadData();
      setStatusMsg('Category deleted');
    } catch (err) { setStatusMsg(err.message); }
  };

  const toggleAssignment = async (productId, checked) => {
    if (!selectedCategoryId) return;
    // Optimistic update
    setAssignments(prev => checked
      ? [...prev, { product_id: productId, category_id: selectedCategoryId }]
      : prev.filter(a => !(a.product_id === productId && a.category_id === selectedCategoryId))
    );
    try {
      await adminFetch(checked ? 'assignProduct' : 'unassignProduct', {
        categoryId: selectedCategoryId,
        productId,
      });
    } catch (err) {
      setStatusMsg(err.message);
      await loadData(selectedCategoryId);
    }
  };

  const toggleHidden = async (productId, hide) => {
    setHiddenProductIds(prev => hide
      ? [...new Set([...prev, productId])]
      : prev.filter(id => id !== productId)
    );
    try {
      await adminFetch(hide ? 'hideProduct' : 'showProduct', { productId });
    } catch (err) {
      setStatusMsg(err.message);
      await loadData(selectedCategoryId);
    }
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>;

  return (
    <div className="admin-cat-layout">
      {/* Sidebar: categories */}
      <div className="admin-cat-sidebar">
        <form className="admin-cat-create" onSubmit={createCategory}>
          <label>New Category</label>
          <input type="text" placeholder="e.g. Hoodies" value={newCategoryName} onChange={e => setNewCategoryName(e.target.value)} />
          <button type="submit">Add</button>
        </form>
        <div className="admin-cat-list">
          {categories.map(cat => (
            <button
              key={cat.id}
              className={`admin-cat-item ${cat.id === selectedCategoryId ? 'active' : ''}`}
              onClick={() => { setSelectedCategoryId(cat.id); setCategoryNameDraft(cat.name); setCategoryFilter('in-category'); }}
            >
              <span>{cat.name}</span>
              <strong>{assignments.filter(a => a.category_id === cat.id).length}</strong>
            </button>
          ))}
        </div>
      </div>

      {/* Main: product list */}
      <div className="admin-cat-main">
        <div className="admin-cat-head">
          <div>
            <h2>{selectedCategory?.name || 'All Products'}</h2>
            {statusMsg && <p style={{ fontSize: 13, color: 'var(--red)', marginTop: 4 }}>{statusMsg}</p>}
          </div>
          <div className="admin-cat-actions">
            <input type="search" placeholder="Search products..." value={adminQuery} onChange={e => setAdminQuery(e.target.value)} />
            <button onClick={() => loadData(selectedCategoryId)}>Refresh</button>
            {selectedCategoryId && <button onClick={deleteCategory} style={{ color: '#e53e3e' }}>Delete Category</button>}
          </div>
        </div>

        <div className="admin-cat-filters">
          {[
            { value: 'all', label: 'All', count: counts.all },
            { value: 'in-category', label: 'In Category', count: counts.inCategory },
            { value: 'categorized', label: 'Categorized', count: counts.categorized },
            { value: 'uncategorized', label: 'Uncategorized', count: counts.uncategorized },
          ].map(opt => (
            <button key={opt.value} className={categoryFilter === opt.value ? 'active' : ''} onClick={() => setCategoryFilter(opt.value)}>
              {opt.label} <span>{opt.count}</span>
            </button>
          ))}
        </div>

        {selectedCategoryId && (
          <form className="admin-cat-edit" onSubmit={updateCategory}>
            <label>Edit category name</label>
            <div>
              <input type="text" value={categoryNameDraft} onChange={e => setCategoryNameDraft(e.target.value)} />
              <button type="submit" disabled={!categoryNameDraft.trim() || categoryNameDraft.trim() === selectedCategory?.name}>Save Name</button>
            </div>
          </form>
        )}

        <div className="admin-cat-products">
          {visibleProducts.map(product => {
            const isHidden = hiddenSet.has(product.id);
            const productCats = categoryNamesByProduct.get(product.id) || [];
            return (
              <div key={product.id} className={`admin-cat-product ${isHidden ? 'hidden-product' : ''}`}>
                <input
                  type="checkbox"
                  checked={assignedProductIds.has(product.id)}
                  disabled={!selectedCategoryId}
                  onChange={e => toggleAssignment(product.id, e.target.checked)}
                />
                <img src={product.image} alt="" />
                <div className="admin-cat-product-info">
                  <span className="admin-cat-product-name">{product.name}</span>
                  <div className="admin-cat-tags">
                    {isHidden && <small className="tag-hidden">Hidden</small>}
                    {productCats.length ? productCats.map(c => <small key={c}>{c}</small>) : <small className="tag-empty">Uncategorized</small>}
                  </div>
                </div>
                <strong>${product.price.toFixed(2)}</strong>
                <button className="admin-cat-hide-btn" onClick={() => toggleHidden(product.id, !isHidden)}>
                  {isHidden ? 'Show' : 'Hide'}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ═══ ADMIN MEDIA — uploads, category photos, custom products ═══ */

// Resize/compress an image File to a data URL so uploads stay small + fast.
function fileToResizedDataUrl(file, maxDim = 1400, quality = 0.82) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          const scale = maxDim / Math.max(width, height);
          width = Math.round(width * scale);
          height = Math.round(height * scale);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        const isPng = /png/i.test(file.type);
        resolve(canvas.toDataURL(isPng ? 'image/png' : 'image/jpeg', quality));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImageFile(file, { folder, name, adminPassword }) {
  const dataUrl = await fileToResizedDataUrl(file);
  const res = await fetch('/api/admin/upload', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
    body: JSON.stringify({ dataUrl, folder, name }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'Upload failed');
  return data.url;
}

function AdminMediaPage({ adminPassword }) {
  const [section, setSection] = useState('categories'); // categories | custom | overrides
  const [categories, setCategories] = useState([]);
  const [customProducts, setCustomProducts] = useState([]);
  const [feedProducts, setFeedProducts] = useState([]);
  const [overrides, setOverrides] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const [draft, setDraft] = useState({ name: '', price: '', description: '', sizes: '', image_urls: [] });
  const [ovSearch, setOvSearch] = useState('');

  const load = async () => {
    setLoading(true);
    try {
      const [catRes, contentRes, prodRes, pfRes, shRes] = await Promise.all([
        fetch('/api/admin/categories'),
        fetch('/api/admin/content'),
        fetch('/api/products'),
        fetch('/api/printify/products').catch(() => null),
        fetch('/api/shopify/products').catch(() => null),
      ]);
      const catData = await catRes.json();
      const content = await contentRes.json();
      const prodData = await prodRes.json();
      const pfData = pfRes ? await pfRes.json().catch(() => ({ products: [] })) : { products: [] };
      const shData = shRes ? await shRes.json().catch(() => ({ products: [] })) : { products: [] };
      setCategories(catData.categories || []);
      setOverrides(content.overrides || {});
      setCustomProducts(content.customProducts || []);
      setFeedProducts([...(prodData.products || []), ...(pfData.products || []), ...(shData.products || [])]);
    } catch (e) { setStatusMsg(e.message); }
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const post = async (url, body) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed');
    return data;
  };

  const withBusy = async (label, fn) => {
    setBusy(true); setStatusMsg(label);
    try { await fn(); }
    catch (e) { setStatusMsg(e.message); setBusy(false); return; }
    setBusy(false);
  };

  // ── Category photos ──
  const setCategoryPhoto = (catId, file) => withBusy('Uploading photo…', async () => {
    const url = await uploadImageFile(file, { folder: 'categories', name: 'category', adminPassword });
    await post('/api/admin/categories', { action: 'setCategoryImage', categoryId: catId, imageUrl: url });
    setStatusMsg('Category photo saved ✓');
    await load();
  });
  const clearCategoryPhoto = (catId) => withBusy('Removing…', async () => {
    await post('/api/admin/categories', { action: 'setCategoryImage', categoryId: catId, imageUrl: null });
    await load();
  });

  // ── Custom products ──
  const addDraftImage = (file) => withBusy('Uploading image…', async () => {
    const url = await uploadImageFile(file, { folder: 'products', name: draft.name || 'product', adminPassword });
    setDraft(d => ({ ...d, image_urls: [...d.image_urls, url] }));
    setStatusMsg('Image added ✓');
  });
  const createCustom = (e) => {
    e.preventDefault();
    if (!draft.name.trim()) { setStatusMsg('Name required'); return; }
    withBusy('Creating…', async () => {
      await post('/api/admin/content', {
        action: 'createCustomProduct',
        name: draft.name, description: draft.description, price: draft.price,
        imageUrls: draft.image_urls,
        sizes: draft.sizes.split(',').map(s => s.trim()).filter(Boolean),
      });
      setDraft({ name: '', price: '', description: '', sizes: '', image_urls: [] });
      setStatusMsg('Product created ✓');
      await load();
    });
  };
  const deleteCustom = (id) => {
    if (!confirm('Delete this product?')) return;
    withBusy('Deleting…', async () => {
      await post('/api/admin/content', { action: 'deleteCustomProduct', id });
      await load();
    });
  };

  // ── Overrides on feed products ──
  const addOverrideImage = (product, file) => withBusy('Uploading mockup…', async () => {
    const url = await uploadImageFile(file, { folder: 'overrides', name: product.name, adminPassword });
    const cur = overrides[product.id] || {};
    await post('/api/admin/content', {
      action: 'setOverride',
      productId: product.id,
      imageUrls: [...(cur.image_urls || []), url],
      name: cur.name || null,
      price: cur.price ?? null,
    });
    setStatusMsg('Mockup added ✓');
    await load();
  });
  const clearOverride = (productId) => withBusy('Clearing…', async () => {
    await post('/api/admin/content', { action: 'clearOverride', productId });
    await load();
  });
  // Persist a new ordering (or empty = clear) of a product's uploaded mockups.
  const saveOverrideImages = (product, imageUrls) => withBusy('Saving…', async () => {
    const cur = overrides[product.id] || {};
    if (imageUrls.length === 0) {
      await post('/api/admin/content', { action: 'clearOverride', productId: product.id });
    } else {
      await post('/api/admin/content', {
        action: 'setOverride', productId: product.id, imageUrls,
        name: cur.name || null, price: cur.price ?? null,
      });
    }
    await load();
  });
  const moveOverrideImage = (product, index, dir) => {
    const arr = [...(overrides[product.id]?.image_urls || [])];
    const j = index + dir;
    if (j < 0 || j >= arr.length) return;
    [arr[index], arr[j]] = [arr[j], arr[index]];
    saveOverrideImages(product, arr);
  };
  const removeOverrideImage = (product, index) => {
    const arr = [...(overrides[product.id]?.image_urls || [])];
    arr.splice(index, 1);
    saveOverrideImages(product, arr);
  };

  if (loading) return <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>;

  const filteredFeed = feedProducts.filter(p =>
    !ovSearch || p.name.toLowerCase().includes(ovSearch.toLowerCase()));

  return (
    <div className="admin-media">
      <div className="admin-media-tabs">
        <button className={section === 'categories' ? 'active' : ''} onClick={() => setSection('categories')}>Category Photos</button>
        <button className={section === 'custom' ? 'active' : ''} onClick={() => setSection('custom')}>Custom Products</button>
        <button className={section === 'overrides' ? 'active' : ''} onClick={() => setSection('overrides')}>Product Photos</button>
      </div>
      {statusMsg && <div className="admin-media-status">{busy && <Loader size={12} className="spin" />} {statusMsg}</div>}

      {/* ── Category Photos ── */}
      {section === 'categories' && (
        <div className="admin-media-body">
          <p className="admin-media-hint">Give each category a photo. It shows in the “Shop by Category” grid on the homepage and as tiles on the Shop page. (Create categories in the Products tab.)</p>
          {categories.length === 0 && <p className="admin-media-empty">No categories yet — add some under the Products tab first.</p>}
          <div className="admin-media-grid">
            {categories.map(cat => (
              <div key={cat.id} className="admin-media-card">
                <div className="admin-media-thumb" style={cat.image_url ? { backgroundImage: `url(${cat.image_url})` } : {}}>
                  {!cat.image_url && <span>No photo</span>}
                </div>
                <div className="admin-media-card-body">
                  <strong>{cat.name}</strong>
                  <div className="admin-media-card-actions">
                    <label className="admin-upload-btn">
                      {cat.image_url ? 'Replace' : 'Upload photo'}
                      <input type="file" accept="image/*" disabled={busy} onChange={e => e.target.files[0] && setCategoryPhoto(cat.id, e.target.files[0])} />
                    </label>
                    {cat.image_url && <button className="admin-link-btn" disabled={busy} onClick={() => clearCategoryPhoto(cat.id)}>Remove</button>}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Custom Products ── */}
      {section === 'custom' && (
        <div className="admin-media-body admin-media-2col">
          <form className="admin-product-form" onSubmit={createCustom}>
            <h3>New Product</h3>
            <label>Name<input value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} placeholder="e.g. SHIFT Signature Tee" /></label>
            <label>Price (USD)<input type="number" step="0.01" value={draft.price} onChange={e => setDraft(d => ({ ...d, price: e.target.value }))} placeholder="45.00" /></label>
            <label>Sizes (comma-separated)<input value={draft.sizes} onChange={e => setDraft(d => ({ ...d, sizes: e.target.value }))} placeholder="S, M, L, XL" /></label>
            <label>Description<textarea rows={3} value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} placeholder="Short product description" /></label>
            <div className="admin-thumb-row">
              {draft.image_urls.map((url, i) => (
                <div key={i} className="admin-thumb-mini" style={{ backgroundImage: `url(${url})` }}>
                  <button type="button" onClick={() => setDraft(d => ({ ...d, image_urls: d.image_urls.filter((_, j) => j !== i) }))}>×</button>
                </div>
              ))}
              <label className="admin-thumb-add">+
                <input type="file" accept="image/*" disabled={busy} onChange={e => e.target.files[0] && addDraftImage(e.target.files[0])} />
              </label>
            </div>
            <button type="submit" disabled={busy} className="admin-primary-btn">Create Product</button>
          </form>
          <div className="admin-custom-list">
            <h3>Your Custom Products ({customProducts.length})</h3>
            {customProducts.length === 0 && <p className="admin-media-empty">None yet — create one on the left.</p>}
            {customProducts.map(cp => (
              <div key={cp.id} className="admin-custom-row">
                <div className="admin-media-thumb sm" style={cp.image ? { backgroundImage: `url(${cp.image})` } : {}}>{!cp.image && <span>—</span>}</div>
                <div className="admin-custom-info">
                  <strong>{cp.name}</strong>
                  <span>${cp.price.toFixed(2)} · {cp.sizes.length} sizes · {cp.colors[0]?.images.length || 0} photos</span>
                </div>
                <button className="admin-link-btn danger" disabled={busy} onClick={() => deleteCustom(cp.customProductId)}>Delete</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Product Photos (overrides) ── */}
      {section === 'overrides' && (
        <div className="admin-media-body">
          <p className="admin-media-hint">Add your own mockups to any product. Use the <strong>‹ ›</strong> arrows to order them — the first one leads on the storefront — and <strong>×</strong> to delete. Your photos show <strong>alongside</strong> the originals.</p>
          <input className="admin-media-search" placeholder="Search products…" value={ovSearch} onChange={e => setOvSearch(e.target.value)} />
          <div className="admin-photo-list">
            {filteredFeed.map(p => {
              const imgs = overrides[p.id]?.image_urls || [];
              const original = p.image || p.colors?.[0]?.images?.[0]?.url;
              return (
                <div key={p.id} className="admin-photo-row">
                  <div className="admin-photo-row-head">
                    <div className="admin-media-thumb sm" style={original ? { backgroundImage: `url(${original})` } : {}}>{!original && <span>—</span>}</div>
                    <div>
                      <strong title={p.name}>{p.name}</strong>
                      <div className="admin-src-tag">{p.source} · {imgs.length} uploaded</div>
                    </div>
                  </div>
                  <div className="admin-photo-strip">
                    {imgs.map((url, idx) => (
                      <div key={url + idx} className="admin-photo-item" style={{ backgroundImage: `url(${url})` }}>
                        {idx === 0 && <span className="admin-photo-lead">Leads</span>}
                        <div className="admin-photo-ctrls">
                          <button title="Move earlier" disabled={busy || idx === 0} onClick={() => moveOverrideImage(p, idx, -1)}>‹</button>
                          <button title="Delete" className="del" disabled={busy} onClick={() => removeOverrideImage(p, idx)}>×</button>
                          <button title="Move later" disabled={busy || idx === imgs.length - 1} onClick={() => moveOverrideImage(p, idx, 1)}>›</button>
                        </div>
                      </div>
                    ))}
                    <label className="admin-thumb-add lg">+
                      <input type="file" accept="image/*" disabled={busy} onChange={e => e.target.files[0] && addOverrideImage(p, e.target.files[0])} />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function AdminDashboard({ adminPassword }) {
  const [adminPage, setAdminPage] = useState('orders');
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();

  const logout = () => {
    sessionStorage.removeItem('shift-admin-pw');
    navigate('/');
    window.location.reload();
  };

  return (
    <div className="admin">
      <div className="admin-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <button className="admin-menu-toggle" onClick={() => setMenuOpen(!menuOpen)}>
            <Menu size={20} />
          </button>
          <img src="/shift-logo.png" alt="Shift" style={{ height: 28 }} />
          <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#888' }}>Admin</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <a href="/" style={{ fontSize: 12, color: '#888', textDecoration: 'none', fontWeight: 600 }}>View Store</a>
          <button onClick={logout} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6 }}>
            <LogOut size={16} /> Logout
          </button>
        </div>
      </div>

      {menuOpen && (
        <div className="admin-menu-overlay" onClick={() => setMenuOpen(false)}>
          <nav className="admin-menu-panel" onClick={e => e.stopPropagation()}>
            <button className="admin-menu-close" onClick={() => setMenuOpen(false)}><X size={20} /></button>
            <button className={adminPage === 'products' ? 'active' : ''} onClick={() => { setAdminPage('products'); setMenuOpen(false); }}>Products</button>
            <button className={adminPage === 'media' ? 'active' : ''} onClick={() => { setAdminPage('media'); setMenuOpen(false); }}>Media</button>
            <button className={adminPage === 'orders' ? 'active' : ''} onClick={() => { setAdminPage('orders'); setMenuOpen(false); }}>Orders</button>
          </nav>
        </div>
      )}

      {adminPage === 'orders' && <AdminOrdersPage adminPassword={adminPassword} />}
      {adminPage === 'products' && <AdminProductsPage adminPassword={adminPassword} />}
      {adminPage === 'media' && <AdminMediaPage adminPassword={adminPassword} />}
    </div>
  );
}

function AdminOrdersPage({ adminPassword }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selected, setSelected] = useState(null);

  const fetchOrders = async () => {
    setLoading(true);
    const res = await fetch(`/api/admin/orders?status=${filter}`, {
      headers: { 'x-admin-key': adminPassword },
    });
    const data = await res.json();
    setOrders(Array.isArray(data) ? data : []);
    setLoading(false);
  };

  useEffect(() => { fetchOrders(); }, [filter]);

  const updateOrder = async (orderId, updates) => {
    await fetch('/api/admin/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'x-admin-key': adminPassword },
      body: JSON.stringify({ orderId, ...updates }),
    });
    fetchOrders();
    if (selected?.id === orderId) {
      setSelected(prev => ({ ...prev, ...updates }));
    }
  };

  const statuses = ['all', 'new', 'processing', 'shipped', 'delivered', 'cancelled'];
  const statusColors = { new: '#e53e3e', processing: '#dd6b20', shipped: '#3182ce', delivered: '#38a169', cancelled: '#718096' };

  return (
    <>
      <div className="admin-stats">
        {['new', 'processing', 'shipped', 'delivered'].map(s => {
          const count = orders.filter(o => filter === 'all' ? o.status === s : true).length;
          return filter === 'all' ? (
            <div key={s} className="admin-stat" onClick={() => setFilter(s)} style={{ cursor: 'pointer' }}>
              <div className="admin-stat-count" style={{ color: statusColors[s] }}>{orders.filter(o => o.status === s).length}</div>
              <div className="admin-stat-label">{s}</div>
            </div>
          ) : null;
        })}
        {filter === 'all' && (
          <div className="admin-stat">
            <div className="admin-stat-count">{orders.length}</div>
            <div className="admin-stat-label">total</div>
          </div>
        )}
      </div>

      <div className="admin-filters">
        {statuses.map(s => (
          <button key={s} className={`filter-btn ${filter === s ? 'active' : ''}`} onClick={() => { setFilter(s); setSelected(null); }}>
            {s === 'all' ? 'All Orders' : s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      <div className="admin-content">
        <div className="admin-orders-list">
          {loading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}><Loader size={20} className="spin" /></div>
          ) : orders.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--gray)' }}>No orders</div>
          ) : (
            orders.map(order => (
              <div
                key={order.id}
                className={`admin-order-row ${selected?.id === order.id ? 'selected' : ''}`}
                onClick={() => setSelected(order)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>#{order.id.slice(0, 8)}</span>
                  <span className="status-badge" style={{ background: statusColors[order.status] + '22', color: statusColors[order.status] }}>
                    {order.status}
                  </span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--gray)' }}>
                  {order.customer?.name || order.customer?.email || 'Guest'}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6, fontSize: 12 }}>
                  <span style={{ color: 'var(--gray)' }}>{new Date(order.created_at).toLocaleDateString()}</span>
                  <span style={{ fontWeight: 600 }}>${Number(order.total).toFixed(2)}</span>
                </div>
              </div>
            ))
          )}
        </div>

        {selected && <AdminOrderDetail order={selected} onUpdate={updateOrder} onClose={() => setSelected(null)} />}
      </div>
    </>
  );
}

function AdminOrderDetail({ order, onUpdate, onClose }) {
  const [tracking, setTracking] = useState(order.tracking_number || '');
  const [trackingUrl, setTrackingUrl] = useState(order.tracking_url || '');
  const [notes, setNotes] = useState(order.admin_notes || '');

  useEffect(() => {
    setTracking(order.tracking_number || '');
    setTrackingUrl(order.tracking_url || '');
    setNotes(order.admin_notes || '');
  }, [order.id]);

  const addr = order.shipping_address || {};
  const statusColors = { new: '#e53e3e', processing: '#dd6b20', shipped: '#3182ce', delivered: '#38a169', cancelled: '#718096' };
  const nextStatus = { new: 'processing', processing: 'shipped', shipped: 'delivered' };

  return (
    <div className="admin-order-detail">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>Order #{order.id.slice(0, 8)}</h3>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--gray)', cursor: 'pointer' }}><X size={18} /></button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Status</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <span className="status-badge" style={{ background: statusColors[order.status] + '22', color: statusColors[order.status], fontSize: 13 }}>
            {order.status}
          </span>
          {nextStatus[order.status] && (
            <button className="admin-action-btn" onClick={() => onUpdate(order.id, { status: nextStatus[order.status] })}>
              Mark as {nextStatus[order.status]}
            </button>
          )}
          {order.status !== 'cancelled' && order.status !== 'delivered' && (
            <button className="admin-action-btn" style={{ color: '#e53e3e' }} onClick={() => {
              if (confirm('Cancel this order?')) onUpdate(order.id, { status: 'cancelled' });
            }}>Cancel</button>
          )}
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Customer</div>
        <div>{order.customer?.name || '—'}</div>
        <div style={{ fontSize: 13, color: 'var(--gray)' }}>{order.customer?.email}</div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Shipping Address</div>
        <div style={{ fontSize: 13, lineHeight: 1.6 }}>
          {addr.name && <div>{addr.name}</div>}
          {addr.line1 && <div>{addr.line1}</div>}
          {addr.line2 && <div>{addr.line2}</div>}
          <div>{[addr.city, addr.state, addr.postal_code].filter(Boolean).join(', ')}</div>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Items</div>
        {(order.items || []).map((item, i) => (
          <div key={i} className="admin-item-row">
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
              <div style={{ fontSize: 12, color: 'var(--gray)' }}>{[item.color, item.size].filter(Boolean).join(' / ')}</div>
            </div>
            <div style={{ fontSize: 13, textAlign: 'right' }}>
              <div>x{item.quantity}</div>
              <div>${Number(item.unit_price).toFixed(2)}</div>
            </div>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 12, paddingTop: 12, borderTop: '1px solid var(--border)', fontWeight: 700 }}>
          <span>Total</span>
          <span>${Number(order.total).toFixed(2)}</span>
        </div>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Tracking</div>
        <input placeholder="Tracking number" value={tracking} onChange={e => setTracking(e.target.value)} className="admin-input" />
        <input placeholder="Tracking URL (optional)" value={trackingUrl} onChange={e => setTrackingUrl(e.target.value)} className="admin-input" style={{ marginTop: 8 }} />
        <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={() => onUpdate(order.id, { tracking_number: tracking, tracking_url: trackingUrl })}>
          Save Tracking
        </button>
      </div>

      <div className="admin-detail-section">
        <div className="admin-detail-label">Notes</div>
        <textarea placeholder="Internal notes..." value={notes} onChange={e => setNotes(e.target.value)} className="admin-input" rows={3} />
        <button className="admin-action-btn" style={{ marginTop: 8 }} onClick={() => onUpdate(order.id, { admin_notes: notes })}>
          Save Notes
        </button>
      </div>

      <div style={{ fontSize: 11, color: 'var(--gray)', marginTop: 16 }}>
        Created: {new Date(order.created_at).toLocaleString()}<br />
        Updated: {new Date(order.updated_at).toLocaleString()}
      </div>
    </div>
  );
}

/* ═══ CUSTOMER PORTAL ═══ */

function AccountPage() {
  const { user, loading, signOut } = useAuth();
  const [authMode, setAuthMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { cart } = useCart();
  const [wasLoggedOut, setWasLoggedOut] = useState(!user);

  // Redirect to checkout after sign-in if cart has items
  useEffect(() => {
    if (wasLoggedOut && user && cart.length > 0) {
      navigate('/checkout');
    }
    if (user) setWasLoggedOut(false);
  }, [user]);

  const handleAuth = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');

    if (authMode === 'magic') {
      const { error } = await supabase.auth.signInWithOtp({ email });
      if (error) setError(error.message);
      else setMessage('Check your email for a login link!');
      return;
    }

    if (authMode === 'login') {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) setError(error.message);
      return;
    }

    if (authMode === 'signup') {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) setError(error.message);
      else setMessage('Account created! Check your email to confirm.');
    }
  };

  if (loading) return <div style={{ padding: '200px 0', textAlign: 'center' }}><Loader size={24} className="spin" /></div>;

  if (!user) {
    return (
      <>
        <div className="scanlines" />
        <div className="portal-auth">
          <div className="portal-auth-card">
            <img src="/shift-logo.png" alt="Shift" style={{ height: 36, filter: 'brightness(0) invert(1)', marginBottom: 24 }} />
            <h2 style={{ fontSize: 20, fontWeight: 800, textTransform: 'uppercase', marginBottom: 8 }}>My Account</h2>
            <p style={{ fontSize: 13, color: 'var(--gray)', marginBottom: 24 }}>
              {cart.length > 0 ? 'Sign in to continue to checkout' : 'Track your orders and manage your account'}
            </p>

            <div className="portal-auth-tabs">
              <button className={authMode === 'login' ? 'active' : ''} onClick={() => setAuthMode('login')}>Sign In</button>
              <button className={authMode === 'signup' ? 'active' : ''} onClick={() => setAuthMode('signup')}>Sign Up</button>
              <button className={authMode === 'magic' ? 'active' : ''} onClick={() => setAuthMode('magic')}>Magic Link</button>
            </div>

            <form onSubmit={handleAuth}>
              <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} required className="portal-input" />
              {authMode !== 'magic' && (
                <input type="password" placeholder="Password" value={password} onChange={e => setPassword(e.target.value)} required className="portal-input" />
              )}
              <button type="submit" className="portal-btn">
                {authMode === 'magic' ? 'Send Magic Link' : authMode === 'signup' ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            {error && <div style={{ color: '#e53e3e', fontSize: 13, marginTop: 12 }}>{error}</div>}
            {message && <div style={{ color: '#38a169', fontSize: 13, marginTop: 12 }}>{message}</div>}
          </div>
        </div>
      </>
    );
  }

  return <CustomerDashboard user={user} onLogout={signOut} />;
}

function CustomerDashboard({ user, onLogout }) {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);

  useEffect(() => {
    async function load() {
      // Get customer's orders via the anon key (RLS filters to their orders)
      const { data } = await supabase
        .from('orders')
        .select('*, items:order_items(*)')
        .order('created_at', { ascending: false });
      setOrders(data || []);
      setLoading(false);
    }
    load();
  }, []);

  const statusSteps = ['new', 'processing', 'shipped', 'delivered'];
  const statusLabels = { new: 'Order Placed', processing: 'Processing', shipped: 'Shipped', delivered: 'Delivered' };
  const statusIcons = { new: Package, processing: Clock, shipped: Truck, delivered: CheckCircle };

  return (
    <>
      <div className="scanlines" />
      <div className="portal">
        <div className="portal-header">
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>My Orders</h1>
            <p style={{ fontSize: 13, color: 'var(--gray)' }}>{user.email}</p>
          </div>
          <button onClick={onLogout} className="portal-logout">
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        {loading ? (
          <div style={{ textAlign: 'center', padding: 60 }}><Loader size={24} className="spin" /></div>
        ) : orders.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 60, color: 'var(--gray)' }}>
            <Package size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <p>No orders yet</p>
            <Link to="/shop" className="hero-cta" style={{ display: 'inline-flex', marginTop: 16 }}>Start Shopping <ArrowRight size={14} /></Link>
          </div>
        ) : (
          <div className="portal-orders">
            {orders.map(order => (
              <div key={order.id} className="portal-order-card" onClick={() => setSelected(selected?.id === order.id ? null : order)}>
                <div className="portal-order-top">
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>Order #{order.id.slice(0, 8)}</div>
                    <div style={{ fontSize: 12, color: 'var(--gray)', marginTop: 2 }}>{new Date(order.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700 }}>${Number(order.total).toFixed(2)}</div>
                    <div style={{ fontSize: 11, color: order.status === 'delivered' ? '#38a169' : 'var(--red)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{order.status}</div>
                  </div>
                </div>

                {/* Status timeline */}
                <div className="portal-timeline">
                  {statusSteps.map((step, i) => {
                    const currentIdx = statusSteps.indexOf(order.status === 'cancelled' ? 'new' : order.status);
                    const active = i <= currentIdx;
                    const Icon = statusIcons[step];
                    return (
                      <div key={step} className={`portal-timeline-step ${active ? 'active' : ''}`}>
                        <div className="portal-timeline-dot"><Icon size={12} /></div>
                        <span>{statusLabels[step]}</span>
                        {i < statusSteps.length - 1 && <div className={`portal-timeline-line ${i < currentIdx ? 'active' : ''}`} />}
                      </div>
                    );
                  })}
                </div>

                {order.status === 'cancelled' && (
                  <div style={{ fontSize: 13, color: '#e53e3e', fontWeight: 600, marginTop: 8 }}>This order was cancelled</div>
                )}

                {selected?.id === order.id && (
                  <div className="portal-order-detail">
                    <div className="portal-detail-label">Items</div>
                    {(order.items || []).map((item, i) => (
                      <div key={i} className="portal-item-row">
                        <div>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{item.product_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--gray)' }}>{[item.color, item.size].filter(Boolean).join(' / ')} x{item.quantity}</div>
                        </div>
                        <div style={{ fontWeight: 600 }}>${(Number(item.unit_price) * item.quantity).toFixed(2)}</div>
                      </div>
                    ))}

                    {order.tracking_number && (
                      <div style={{ marginTop: 16 }}>
                        <div className="portal-detail-label">Tracking</div>
                        {order.tracking_url ? (
                          <a href={order.tracking_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--red)', fontSize: 13 }}>
                            {order.tracking_number} <ArrowRight size={12} />
                          </a>
                        ) : (
                          <span style={{ fontSize: 13 }}>{order.tracking_number}</span>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default function App() {
  const location = window.location.pathname;
  const isAdmin = location.startsWith('/dashadmin');

  // Admin routes don't need the store layout
  if (isAdmin) {
    return (
      <BrowserRouter>
        <Routes>
          <Route path="/dashadmin" element={<AdminPage />} />
        </Routes>
      </BrowserRouter>
    );
  }

  return (
    <BrowserRouter>
      <AuthProvider>
        <ProductsProvider>
          <CartProvider>
            <ScrollToTop />
            <Header />
            <CartDrawer />
            <Routes>
              <Route path="/" element={<HomePage />} />
              <Route path="/shop" element={<ShopPage />} />
              <Route path="/product/:id" element={<ProductPage />} />
              <Route path="/collections" element={<CollectionsPage />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/checkout" element={<RequireAuth><CheckoutPage /></RequireAuth>} />
              <Route path="/order-success" element={<OrderSuccessPage />} />
              <Route path="/account" element={<AccountPage />} />
            </Routes>
            <Footer />
          </CartProvider>
        </ProductsProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
