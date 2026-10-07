export function PrivacyPage() {
  return (
    <article className="legal-page page-shell">
      <p className="eyebrow eyebrow--dark">Confidentialité</p>
      <h1>Comprendre comment votre parcours est partagé.</h1>
      <p>
        Ce prototype sépare les informations de profil des coordonnées personnelles. Dans la
        configuration Supabase fournie, seuls les membres authentifiés peuvent parcourir les
        profils complets et chaque personne garde le contrôle de la visibilité de son contact.
        Les portraits Highlight, eux, sont visibles par tous sur l’accueil, sans connexion.
      </p>
      <h2>Données collectées</h2>
      <p>
        Nom, prénom, statut, promotion, parcours, spécialités, expérience, ville, pays, photo et
        moyen de contact. Le genre est facultatif et déclaré par la personne pour équilibrer
        les duos Highlight et adapter les pronoms et les accords du portrait. Il n’est jamais
        déduit du nom ou de la photo. Le mentorat est volontaire et peut être désactivé à tout moment.
        Si vous écrivez à un membre ou répondez à une demande, les messages échangés et les
        coordonnées que vous choisissez de partager sont aussi enregistrés (voir plus bas).
      </p>
      <h2>Inscription et connexion avec Google</h2>
      <p>
        Si vous choisissez Google, votre adresse e-mail, votre nom et votre photo de compte,
        lorsqu’ils sont disponibles, sont transmis à Supabase pour vous identifier. Votre nom
        et votre photo peuvent servir à préremplir votre profil. Vous complétez et vérifiez
        les informations de votre parcours avant de rejoindre l’annuaire. Cette connexion
        ne demande aucun accès à vos messages Gmail, à Google Drive ou à vos contacts Google.
      </p>
      <h2 id="highlights">Les portraits Highlight</h2>
      <p>
        Chaque semaine, deux profils alumni actifs sont tirés au sort pour être mis à l’honneur.
        Leurs noms, photo, promotion, spécialité, ville, pays et portrait sont publiés sur
        l’accueil. Cette publication est accessible à toute personne, même sans compte.
      </p>
      <p>
        Pour rédiger ces portraits, les informations nécessaires sur le parcours sont envoyées
        à OpenAI, un service d’intelligence artificielle, avec une indication d’accord féminin,
        masculin ou neutre issue de votre choix de genre. Sans précision, le texte utilise votre
        prénom et des formulations neutres. Les données de connexion et les
        coordonnées enregistrées dans les champs de contact ne sont pas transmises. Le texte est fondé sur
        les informations du profil, puis enregistré pour la semaine ; chaque visite ne déclenche
        pas une nouvelle rédaction.
      </p>
      <p>
        Vous pouvez corriger vos informations dans votre espace membre. Un portrait déjà publié
        reflète les informations du profil au moment de sa rédaction. N’ajoutez pas de coordonnées
        privées dans le texte de votre parcours : ce texte peut être transmis à OpenAI et repris
        dans un portrait public.
      </p>
      <h2 id="demandes">Demandes, messages et coordonnées partagées</h2>
      <p>
        Quand un membre vous écrit — depuis votre profil, depuis l’une de vos offres ou par une
        demande de mentorat —, son message est enregistré et n’est visible que par vous et par lui,
        dans la page « Demandes ». Personne d’autre ne peut le lire, pas même les autres membres.
        L’auteur d’une demande encore sans réponse peut la retirer.
      </p>
      <p>
        Vos coordonnées ne sont jamais partagées automatiquement. En acceptant une demande, un
        formulaire vous demande ce que vous souhaitez partager : votre adresse e-mail et/ou un
        numéro WhatsApp que vous saisissez à ce moment-là. Vous pouvez ne partager que l’un des deux.
        Si vous déclinez, rien n’est partagé. Les coordonnées choisies sont rattachées à cette
        demande, visibles uniquement par vous deux ; elles ne sont pas ajoutées à votre profil ni
        affichées dans l’annuaire. La demande, son message et les coordonnées partagées sont
        supprimés si l’un des deux comptes est supprimé.
      </p>
      <h2 id="notifications">Notifications par e-mail</h2>
      <p>
        Pour vous prévenir qu’une demande vous attend, ou que la vôtre a été acceptée, le site
        envoie un e-mail à l’adresse de votre compte. Cet e-mail contient uniquement le nom de la
        personne concernée, le titre de l’offre le cas échéant et un lien vers votre espace : jamais
        le texte du message ni aucune coordonnée, qui ne se consultent qu’après connexion. Un refus
        n’est pas notifié par e-mail ; la personne le voit dans « Demandes ».
      </p>
      <p>
        L’envoi des e-mails est assuré par Brevo, un service d’envoi d’e-mails, qui reçoit pour cela
        l’adresse du destinataire et le contenu de la notification. Vous n’avez pas besoin
        de compte chez ce prestataire.
      </p>
      <h2>Mode démonstration</h2>
      <p>
        Tant que Supabase n’est pas configuré, le formulaire ne crée aucun compte distant. Il
        conserve uniquement un aperçu de profil dans le navigateur, sans enregistrer le mot de
        passe.
      </p>
    </article>
  );
}
