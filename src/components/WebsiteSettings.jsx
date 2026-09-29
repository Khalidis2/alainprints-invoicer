export default function WebsiteSettings({ filaments, items }) {
  const availableSpools = filaments
    .filter((item) => item.stockStatus === "available")
    .reduce((sum, item) => sum + Math.floor(Number(item.remainingG || 0) / Number(item.spoolWeightG || 1000)), 0);

  return (
    <section>
      <div className="admin-section-heading">
        <div>
          <span className="admin-eyebrow">PRINTTOOLS3D</span>
          <h2>Website controls</h2>
          <p>The website reads its sellable filament stock from this Supabase inventory.</p>
        </div>
        <a className="admin-site-link" href="https://www.printtools3d.com/store" target="_blank" rel="noreferrer">Preview Store ↗</a>
      </div>

      <div className="website-settings-grid">
        <article>
          <span>Store inventory</span>
          <strong>{availableSpools} sellable spools</strong>
          <p>Edit stock, material, colour and selling price from the Filament tab. Available full spools appear in the Store automatically.</p>
        </article>
        <article>
          <span>Printed products</span>
          <strong>{items.length} saved products</strong>
          <p>Edit names, images and prices from Printed products. These records are ready for the public product catalogue connection.</p>
        </article>
        <article>
          <span>Store rules</span>
          <strong>Live inventory only</strong>
          <p>Incoming filament and partial spools below one full spool stay hidden from customers.</p>
        </article>
      </div>
    </section>
  );
}
