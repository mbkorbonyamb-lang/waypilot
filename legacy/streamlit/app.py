
import io
import pandas as pd
import streamlit as st

st.set_page_config(
    page_title="WayPilot",
    page_icon="🧭",
    layout="wide"
)

st.title("🧭 WayPilot")
st.subheader("Moins d’erreurs. Des catalogues prêts à vendre.")
st.write(
    "Importez un catalogue CSV WooCommerce, "
    "détectez les anomalies et téléchargez votre rapport."
)

st.info("Version bêta — vérifiez les résultats avant de modifier votre catalogue.")

ALIASES = {
    "name": ["name", "nom", "nom du produit"],
    "price": ["regular price", "regular_price", "prix", "prix régulier"],
    "description": ["description", "short description", "description courte"],
    "sku": ["sku", "référence", "reference"]
}

def trouver_colonne(colonnes, type_col):
    for alias in ALIASES[type_col]:
        if alias in colonnes:
            return alias
    return None

def analyser(df):
    df.columns = [str(c).strip().lower() for c in df.columns]

    nom_col = trouver_colonne(df.columns, "name")
    prix_col = trouver_colonne(df.columns, "price")
    desc_col = trouver_colonne(df.columns, "description")
    sku_col = trouver_colonne(df.columns, "sku")

    anomalies = []
    noms_vus = {}
    skus_vus = {}

    for i, ligne in df.iterrows():
        numero = i + 2

        nom = (
            str(ligne[nom_col]).strip()
            if nom_col and pd.notna(ligne[nom_col])
            else ""
        )
        prix = ligne[prix_col] if prix_col else None
        description = (
            str(ligne[desc_col]).strip()
            if desc_col and pd.notna(ligne[desc_col])
            else ""
        )

        def signaler(message, gravite):
            anomalies.append({
                "Ligne CSV": numero,
                "Produit": nom,
                "Anomalie": message,
                "Gravité": gravite
            })

        if not nom:
            signaler("Nom du produit manquant", "Élevée")
        elif nom.casefold() in noms_vus:
            signaler(
                f"Nom en double (ligne {noms_vus[nom.casefold()]})",
                "Moyenne"
            )
        else:
            noms_vus[nom.casefold()] = numero

        if prix_col is None or pd.isna(prix) or str(prix).strip() == "":
            signaler("Prix manquant", "Élevée")
        else:
            try:
                valeur = float(str(prix).strip().replace(",", "."))
                if valeur <= 0:
                    signaler("Prix nul ou négatif", "Élevée")
            except ValueError:
                signaler("Format de prix invalide", "Élevée")

        if not description:
            signaler("Description manquante", "Moyenne")

        if sku_col:
            sku = (
                str(ligne[sku_col]).strip()
                if pd.notna(ligne[sku_col])
                else ""
            )
            if sku and sku.casefold() != "nan":
                if sku.casefold() in skus_vus:
                    signaler(
                        f"Référence SKU en double (ligne {skus_vus[sku.casefold()]})",
                        "Élevée"
                    )
                else:
                    skus_vus[sku.casefold()] = numero

    return pd.DataFrame(
        anomalies,
        columns=["Ligne CSV", "Produit", "Anomalie", "Gravité"]
    )

fichier = st.file_uploader(
    "Choisissez votre catalogue au format CSV",
    type=["csv"]
)

if fichier is not None:
    try:
        contenu = fichier.getvalue()

        try:
            df = pd.read_csv(io.BytesIO(contenu), encoding="utf-8-sig")
        except UnicodeDecodeError:
            df = pd.read_csv(io.BytesIO(contenu), encoding="latin-1")

        if df.empty:
            st.error("Le fichier ne contient aucun produit.")
        else:
            st.success(f"Catalogue importé : {len(df)} lignes de données.")
            st.write("Aperçu du catalogue")
            st.dataframe(df.head(10), use_container_width=True)

            if st.button("Analyser mon catalogue", type="primary"):
                rapport = analyser(df.copy())

                st.session_state["rapport_waypilot"] = rapport
                st.session_state["nb_produits"] = len(df)

    except Exception as erreur:
        st.error(f"Impossible de lire ce fichier : {erreur}")

if "rapport_waypilot" in st.session_state:
    rapport = st.session_state["rapport_waypilot"]
    nb = st.session_state["nb_produits"]

    st.divider()
    st.header("Résultats du contrôle qualité")

    c1, c2, c3 = st.columns(3)
    c1.metric("Produits analysés", nb)
    c2.metric("Anomalies détectées", len(rapport))
    c3.metric(
        "Anomalies élevées",
        int((rapport["Gravité"] == "Élevée").sum())
    )

    if rapport.empty:
        st.success("Aucune anomalie détectée par les contrôles actuels.")
    else:
        st.dataframe(rapport, use_container_width=True)

    csv_rapport = rapport.to_csv(index=False).encode("utf-8-sig")
    st.download_button(
        "Télécharger le rapport CSV",
        data=csv_rapport,
        file_name="rapport_waypilot.csv",
        mime="text/csv"
    )

st.caption("WayPilot — Le contrôle qualité intelligent de vos catalogues e-commerce.")
