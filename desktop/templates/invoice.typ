// Za šablonou následuje vložení ISDOC (viz `invoiceTypst` v `invoice/template.ts`).
// Data chodí v `invoice.json` **už naformátovaná** jako řetězce, ať se
// sazba nerozejde s tím, co appka ukazuje na obrazovce.
//
// Boční pás je nakreslený jako pozadí stránky, ne jako buňka mřížky: díky tomu
// sahá od kraje ke kraji i tehdy, když je obsah kratší než stránka, a při
// přetečení na druhou stranu se zopakuje.

#let inv = json("invoice.json")
#let has_logo = inv.has_logo
#let has_qr = inv.has_qr
#let is_credit = inv.kind == "credit-note"

#let bar_w = 6.2cm
#let bar_pad = 1.15cm
#let bar = luma(247)
#let accent = rgb("#2f5d50")

/// Nepovinná hodnota: prázdnou vynechá i s popiskem, ať v dokladu nezůstane
/// „IBAN:" bez IBANu.
#let opt(value, body) = if value != "" { body }

/// Výzva k úhradě a platební údaje. Dobropis peníze nevybírá, takže je vynechá — jinak by
/// odběratele vyzýval k úhradě záporné částky na účet dodavatele.
#let payment(body) = if not is_credit { body }

#let label(t) = text(size: 7pt, tracking: 0.14em, fill: luma(130))[#upper(t)]

#set page(
  paper: "a4",
  margin: (left: 0cm, right: 0cm, top: 0cm, bottom: 1.2cm),
  background: place(left + top, rect(width: bar_w, height: 100%, fill: bar)),
  // Patka je na každé straně dokladu a nikdy se nepere s obsahem.
  footer: pad(left: bar_w + 1.5cm, right: 1.7cm, align(right, text(size: 7.5pt, fill: luma(155))[
    Vystaveno ve Fakturianu · #link("https://" + inv.web)[#inv.web]
  ])),
)
#set text(font: "Libertinus Serif", size: 10pt, lang: "cs", fill: luma(25))

#grid(
  columns: (bar_w, 1fr),

  block(inset: (x: bar_pad, y: 1.9cm))[
    #if has_logo [
      // Pevná šířka, ať široké logo nepřeteče přes okraj pásu.
      #box(width: bar_w - 2 * bar_pad, height: 1.3cm, image("logo.png", fit: "contain", alt: "Logo dodavatele"))
      #v(0.7em)
    ]
    #text(size: 11.5pt, weight: "bold")[#inv.supplier.name]

    #v(1.2em)
    #label("Kontakt") #v(0.4em)
    #text(size: 9pt)[
      #inv.supplier.address.street \
      #inv.supplier.address.zip #inv.supplier.address.city \
      #v(0.35em)
      #opt(inv.supplier.email)[#inv.supplier.email \ ]
      IČO: #inv.supplier.ico
      #opt(inv.supplier.dic)[\ DIČ: #inv.supplier.dic]
      #opt(inv.supplier.registration)[\ #inv.supplier.registration]
    ]

    #v(1.4em)
    #line(length: 100%, stroke: 0.4pt + luma(200))
    #v(1.1em)

    #payment[
      #label("Platební údaje") #v(0.4em)
      #text(size: 9pt)[
        #opt(inv.bank_account)[
          #text(fill: luma(115))[Účet] \ #inv.bank_account \
          #v(0.3em)
        ]
        #opt(inv.iban)[
          #text(fill: luma(115))[IBAN] \ #inv.iban \
          #v(0.3em)
        ]
        #text(fill: luma(115))[Variabilní symbol] \ #inv.variable_symbol
      ]
    ]

    // QR platba (SPAYD) vznikne jen tehdy, když je z čeho sestavit účet.
    #if has_qr [
      #v(1.1em)
      #image("qr.png", width: 2.5cm, alt: "QR kód pro platbu faktury")
      #v(0.25em)
      #label("QR platba")
    ]

    #opt(inv.vat_note)[
      #v(1.4em)
      #text(size: 8.5pt, fill: luma(115))[#inv.vat_note]
    ]
  ],

  block(inset: (left: 1.5cm, right: 1.7cm, top: 1.9cm, bottom: 0.8cm))[
    #text(size: 24pt, weight: "bold")[#inv.title]
    #h(0.4em)
    #text(size: 15pt, fill: luma(120))[#inv.number]
    // Ne „opravný daňový doklad": to je pojem zákona o DPH (§ 45) pro plátce a na dokladu
    // neplátce by budil dojem, že vystavitel plátcem je (§ 435 odst. 2 OZ).
    #if is_credit [
      #v(0.3em)
      #text(size: 9.5pt, fill: luma(90))[
        Opravný doklad#opt(inv.original_invoice)[ k faktuře #inv.original_invoice]
      ]
    ]

    #v(1.4em)
    #label("Odběratel") #v(0.45em)
    #text(size: 11.5pt, weight: "bold")[#inv.customer.name] \
    #opt(inv.customer.address.street)[#inv.customer.address.street \ ]
    #opt(inv.customer.address.zip + inv.customer.address.city)[#inv.customer.address.zip #inv.customer.address.city \ ]
    #v(0.3em)
    #text(size: 9pt)[
      #opt(inv.customer.ico)[IČO: #inv.customer.ico]
      #opt(inv.customer.dic)[#h(1em) DIČ: #inv.customer.dic]
    ]

    #v(1.5em)
    #grid(columns: (2.5cm, 2.5cm), gutter: 0.5cm,
      [#label("Vystaveno") \ #v(0.25em) #inv.issue_date],
      ..if not is_credit {
        ([#label("Splatnost") \ #v(0.25em) #text(weight: "bold")[#inv.due_date]],)
      } else { () },
    )

    #v(1.6em)
    #table(
      columns: (1fr, 1.7cm, 2.3cm, 2.6cm),
      align: (left, right, right, right),
      stroke: none,
      inset: (x: 0pt, y: 7pt),
      table.hline(stroke: 0.9pt + accent),
      table.header(
        [#label("Popis")], [#label("Množ.")], [#label("Cena/MJ")], [#label("Celkem")],
      ),
      table.hline(stroke: 0.4pt + luma(210)),
      ..inv.lines.map(l => ([#l.description], [#l.quantity #l.unit], [#l.unit_price], [#l.total])).flatten(),
      table.hline(stroke: 0.4pt + luma(210)),
    )

    #v(1.2em)
    #align(right)[
      #label("Celkem " + lower(inv.due_label)) #v(0.35em)
      #text(size: 19pt, weight: "bold", fill: accent)[#inv.due_total #inv.currency]
    ]

    #opt(inv.note)[
      #v(1.6em)
      #text(size: 9pt, style: "italic", fill: luma(95))[#inv.note]
    ]
  ],
)
