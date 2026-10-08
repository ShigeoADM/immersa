// Textos legales en inglés y japonés. La versión de referencia es la española
// (constants/legal.ts): si se cambia algo allí, hay que cambiarlo también aquí.

import { ADULT_AGE, MIN_AGE } from '@/constants/age';
import {
  LEGAL_CONTACT_EMAIL, LEGAL_DOCS, LEGAL_OWNER_NAME, LEGAL_UPDATED_AT, type LegalDoc, type LegalSection,
} from '@/constants/legal';
import { type Lang } from '@/i18n';

type Docs = Record<LegalDoc, { title: string; sections: LegalSection[] }>;

// Aviso al principio de las traducciones: en caso de duda manda el texto en español
export const LEGAL_TRANSLATION_NOTE: Record<Lang, string | null> = {
  es: null,
  en: 'This is a translation provided for convenience. If there is any difference between this text and the Spanish version, the Spanish version prevails.',
  ja: 'これは参考のための翻訳です（AIによる翻訳）。この文章とスペイン語版の内容に相違がある場合は、スペイン語版が優先されます。',
};

export const LEGAL_UPDATED: Record<Lang, string> = {
  es: `Última actualización: ${LEGAL_UPDATED_AT}`,
  en: 'Last updated: October 8, 2026',
  ja: '最終更新日：2026年10月8日',
};

const EN: Docs = {
  terms: {
    title: 'Terms of use',
    sections: [
      {
        title: '1. What Immersa is',
        body: `Immersa is a service for reading and publishing novels written by its users, available as a mobile app and as a website (https://immersa.web.app), developed and operated by ${LEGAL_OWNER_NAME}. By creating an account or using the app or the website you accept these terms. On the website you can browse and read without an account; to publish, comment or save stories you need to register. If you do not agree, do not use it.`,
      },
      {
        title: '2. Your account',
        body: `To have an account you must be at least ${MIN_AGE} years old and provide true information, including your date of birth. You are responsible for whatever is done from your account and for keeping your password secret. You can delete your account at any time from Profile → Settings.`,
      },
      {
        title: '3. The content you publish',
        body: 'The stories, comments, images and audio you upload remain yours. By publishing them you give us permission to store them and show them to other users within the app, solely so that the service can work. You may only upload content that you created or have permission to use: do not upload works, images or music belonging to others without authorisation.',
      },
      {
        title: '4. Adult content',
        body: `If a story contains explicit sexual material, gore, extreme violence or illustrations with partial nudity, you must mark it as 18+ content and state the reason. That content is only shown to users aged ${ADULT_AGE} or over. Marking a story incorrectly may lead to its removal.

That refers to the text of the story. Images (covers, backgrounds and illustrations) have their own rules:

· They may never show sexual acts or sexual content, not even in 18+ stories.

· Photographs or realistic images of nudity are not allowed, nor is real violence.

· In illustrations (drawings), partial nudity without sexual intent, such as breasts or buttocks, is allowed as long as the image does not focus solely on that. A story with such illustrations must be marked as 18+.

· Genitals and the anus may never be shown. If they appear in a scene that is not sexual (a comic situation, for example), they must be covered or censored, in the style of manga and anime. Censored in that way, they do not require the story to be marked as 18+.

· Never, under any circumstances, is nudity of minors allowed, nor of characters who are or appear to be minors.

· Profile pictures may not contain nudity.`,
      },
      {
        title: '5. What is not allowed',
        body: 'The following are not allowed: sexual content involving minors or that sexualises them; images with sexual content, with visible genitals, with photographic or realistic nudity, or with real violence; any nudity of minors or of characters who appear to be minors; incitement to hatred, harassment or threats; illegal content or content that promotes illegal activities; plagiarism or copyright infringement; spam, deception or impersonation; attempting to manipulate statistics, access other people\'s accounts or damage the service.',
      },
      {
        title: '6. Moderation and reports',
        body: 'You can report stories and comments from within the app. The moderation team may remove content that breaches these terms and, in serious or repeated cases, suspend or delete the account. When a story is removed, its author is notified.',
      },
      {
        title: '7. Availability and liability',
        body: 'The app is provided as is. We do our best to make it work well, but we do not guarantee that it will always be available or free of errors, and it may change or cease to be offered. Content published by users is the responsibility of whoever publishes it and does not reflect the opinion of Immersa. We recommend that you keep a copy of your texts.',
      },
      {
        title: '8. Changes to these terms',
        body: `We may update these terms. If the change is significant, notice will be given within the app. Continuing to use the app after the change means you accept it. If you have any questions you can contact us by writing to ${LEGAL_CONTACT_EMAIL}.`,
      },
    ],
  },
  uploads: {
    title: 'Images, music and copyright',
    sections: [
      { title: 'What you can upload', body: 'You can upload any images, music and sounds you want, as long as they are not illegal.' },
      {
        title: 'If someone makes a claim',
        body: `If you use someone else's material and the rights holder asks us to take it down, we will have to remove it from your story. We will let you know beforehand so you can replace it. If you hold the rights to something published on Immersa and want it removed, you can request it by writing to ${LEGAL_CONTACT_EMAIL} or with the story's report button.`,
      },
      {
        title: 'Our recommendation',
        body: 'The safest option is to use your own material or freely licensed material, and to name its authors in the credits. Each story has a credits section for that purpose, in its details.',
      },
      {
        title: 'What happens to your images',
        body: 'Immersa does not keep your original files: images are reduced when uploaded, and readers cannot download them from the website. If you want to sign or watermark your illustrations, do so before uploading them.',
      },
    ],
  },
  privacy: {
    title: 'Privacy policy',
    sections: [
      {
        title: '1. Who is responsible',
        body: `${LEGAL_OWNER_NAME} (hereinafter, "we") develops and operates the Immersa mobile application and is the controller of its users' personal data. This policy explains what data we collect, what we use it for and what you can do about it. By using Immersa you accept what is described here.`,
      },
      {
        title: '2. What data we collect',
        body: 'Account data: email address, username, password (encrypted; we cannot see it) and date of birth.\n\nProfile data you choose to add: photo, biography and whether you want to show your email.\n\nContent you publish: stories, chapters, images, audio and comments.\n\nActivity in the app: stories you save or read and where you are in them, bookmarks, likes, authors you follow and notifications.\n\nTechnical data: the Google services used by the app may automatically record data such as the IP address, the device model or the operating system version, which are necessary to provide the service.',
      },
      {
        title: '3. What we use it for',
        body: 'Solely to make the app work: identifying you, saving your reading progress, showing your content to other readers, notifying you of news (new chapters, comments, team announcements), checking age for 18+ content, showing each author aggregate statistics about their stories and moderating content. We do not sell your data, we do not use it for advertising and the app does not include analytics or advertising tracking tools.',
      },
      {
        title: '4. What others see',
        body: 'Public: your username, photo, biography, the stories you publish, your comments and, if you hold a role, your badge. Other users see it, as do people who visit the web version without an account, and it may appear in search engines. Your email is only visible if you turn that on in Settings; in that case it is also public.\n\nPrivate: your date of birth, your library, your reading progress, your bookmarks and your notifications. Authors see how many people read or save their stories, but not who they are.',
      },
      {
        title: '5. Where it is stored and third-party services',
        body: 'The data is stored in Firebase, a Google service (authentication, database, file storage and hosting of the web version), which acts as a technical provider and may process data on servers outside your country with the safeguards required by law. On Android the app also uses Google Play Services, which are necessary for it to work. The web version loads a typeface from Google Fonts and stores in your browser the data needed to keep you logged in and remember your reading preferences; it does not use advertising or tracking cookies.\n\nYou can see how they handle data in the Google Privacy Policy (https://policies.google.com/privacy) and on the Firebase privacy and security page (https://firebase.google.com/support/privacy).\n\nSome preferences (reading theme, font size, drafts) are stored only on your device.',
      },
      {
        title: '6. Permissions the app asks for',
        body: 'Notifications: to let you know about news (new chapters, comments, team announcements). They are generated by your own phone when it checks for news, and you can turn them off in the system settings at any time.\n\nImage gallery: only when you choose a profile picture, a cover or a background for a story. The app only accesses the image you select.\n\nAudio files: only when you choose a music track or a sound effect for a story.\n\nThe app does not access your photos or files on its own: only the ones you choose, and they are only uploaded when you add them.',
      },
      {
        title: '7. External content and links',
        body: 'Authors can include in their stories images or audio hosted on external services (for example, a Google Drive link). When you read those stories, your device connects to those services to download them, and they may record technical data such as your IP address. Those sites are not operated by us and are governed by their own privacy policies.',
      },
      {
        title: '8. Security',
        body: 'We apply reasonable measures to protect your data: connections are encrypted, passwords are stored encrypted and access to information is limited by security rules (for example, nobody else can read your library or your date of birth). Even so, no method of transmission over the internet or of electronic storage is 100% secure, so we cannot guarantee absolute security.',
      },
      {
        title: '9. How long we keep it',
        body: 'For as long as you have the account. When you delete it from Profile → Settings, your profile, your stories, your library, your notifications and your likes are deleted. Comments you have left on other people\'s stories may remain; if you want them removed, write to us.',
      },
      {
        title: '10. Your rights',
        body: `You can access your data, correct it, request its deletion, object to its use or request a copy. You can do most of these things yourself from the app; for the rest, contact us by writing to ${LEGAL_CONTACT_EMAIL}. You also have the right to lodge a complaint with the data protection authority of your country.`,
      },
      {
        title: '11. Minors',
        body: `The app is not aimed at people under ${MIN_AGE} and creating an account below that age is not allowed. If we discover that someone under that age has given us data, we will delete their account. Content marked as 18+ is only shown to users aged ${ADULT_AGE} or over.`,
      },
      {
        title: '12. Changes to this policy and contact',
        body: `If the way we handle your data changes, we will update this policy and give notice within the app when the change is relevant. If you have any questions about this policy you can contact us by writing to ${LEGAL_CONTACT_EMAIL}.`,
      },
    ],
  },
};

const JA: Docs = {
  terms: {
    title: '利用規約',
    sections: [
      {
        title: '1. Immersaとは',
        body: `Immersaは、ユーザーが書いた小説を読んだり公開したりできるサービスで、モバイルアプリおよびウェブサイト（https://immersa.web.app）として提供されています。開発・運営は ${LEGAL_OWNER_NAME} が行っています。アカウントを作成するか、アプリまたはウェブサイトを利用することで、本規約に同意したものとみなされます。ウェブサイトではアカウントなしで作品を探したり読んだりできますが、公開、コメント、作品の保存には登録が必要です。同意されない場合は、利用しないでください。`,
      },
      {
        title: '2. アカウント',
        body: `アカウントを持つには${MIN_AGE}歳以上である必要があり、生年月日を含めて正しい情報を登録しなければなりません。ご自身のアカウントで行われたすべての行為と、パスワードの管理については、ご本人が責任を負います。アカウントは「プロフィール → 設定」からいつでも削除できます。`,
      },
      {
        title: '3. 公開するコンテンツ',
        body: 'アップロードした作品、コメント、画像、音声の権利は、引き続きあなたに帰属します。公開することで、サービスを機能させる目的に限り、それらを保存し、アプリ内で他のユーザーに表示することを当方に許可したものとします。アップロードできるのは、ご自身が作者であるもの、または使用許可を得ているものだけです。第三者の作品、画像、音楽を無断でアップロードしないでください。',
      },
      {
        title: '4. 成人向けコンテンツ',
        body: `作品に露骨な性的表現、ゴア表現、過度な暴力、または部分的な裸体を含むイラストが含まれる場合は、18歳以上向けコンテンツとして設定し、その理由を示す必要があります。そのコンテンツは${ADULT_AGE}歳以上のユーザーにのみ表示されます。設定を誤った作品は削除されることがあります。

これは作品の本文についての決まりです。画像（表紙、背景、イラスト）には別のルールがあります。

· 性行為や性的な内容を描いた画像は、18歳以上向けの作品であっても一切掲載できません。

· 裸体の写真や写実的な画像、現実の暴力を写した画像は認められません。

· イラスト（絵）については、胸や臀部など、性的な意図のない部分的な裸体は、それだけを強調した画像でない限り認められます。そのようなイラストを含む作品は、18歳以上向けとして設定する必要があります。

· 性器および肛門は決して表示できません。性的ではない場面（コミカルな場面など）に登場する場合は、マンガやアニメのように隠すか修正を入れてください。そのように修正されていれば、18歳以上向けに設定する必要はありません。

· 未成年者、または未成年である、もしくは未成年に見えるキャラクターの裸体は、いかなる場合も認められません。

· プロフィール画像に裸体を含めることはできません。`,
      },
      {
        title: '5. 禁止事項',
        body: '次の行為・内容は禁止されています。未成年者を含む性的な内容、または未成年者を性的に描く内容。性的な内容を含む画像、性器が見える画像、写真や写実的な裸体の画像、現実の暴力を写した画像。未成年者または未成年に見えるキャラクターの裸体。憎悪の扇動、嫌がらせ、脅迫。違法な内容、または違法行為を助長する内容。盗作や著作権の侵害。スパム、詐欺、なりすまし。統計の不正操作、他人のアカウントへのアクセス、サービスに損害を与える行為。',
      },
      {
        title: '6. モデレーションと通報',
        body: '作品やコメントは、アプリ内から通報できます。モデレーションチームは、本規約に違反するコンテンツを削除することができ、重大な場合や繰り返される場合には、アカウントを停止または削除することがあります。作品が削除された場合は、作者に通知されます。',
      },
      {
        title: '7. 提供状況と責任',
        body: '本アプリは現状のまま提供されます。正常に動作するよう努めますが、常に利用できること、不具合がないことを保証するものではなく、内容の変更や提供の終了が行われる場合があります。ユーザーが公開したコンテンツの責任は公開した本人にあり、Immersaの見解を示すものではありません。ご自身の文章は控えを保管しておくことをおすすめします。',
      },
      {
        title: '8. 本規約の変更',
        body: `本規約は更新されることがあります。重要な変更の場合は、アプリ内でお知らせします。変更後も利用を続けた場合は、変更に同意したものとみなされます。ご不明な点は ${LEGAL_CONTACT_EMAIL} までご連絡ください。`,
      },
    ],
  },
  uploads: {
    title: '画像・音楽と著作権',
    sections: [
      { title: 'アップロードできるもの', body: '違法なものでなければ、画像・音楽・効果音を自由にアップロードできます。' },
      {
        title: '権利者から申し立てがあった場合',
        body: `他の人の素材を使用し、権利者から削除の依頼があった場合は、作品から取り除く必要があります。差し替えられるよう、事前にお知らせします。Immersaで公開されているものの権利をお持ちで、削除をご希望の場合は、${LEGAL_CONTACT_EMAIL} へのメール、または作品の通報ボタンからご依頼ください。`,
      },
      {
        title: 'おすすめの方法',
        body: '自作の素材やフリーライセンスの素材を使い、クレジットに作者名を記載するのが最も安全です。各作品の詳細には、そのためのクレジット欄があります。',
      },
      {
        title: '画像の取り扱い',
        body: 'Immersaは元のファイルを保存しません。画像はアップロード時に縮小され、読者がウェブサイトからダウンロードすることはできません。イラストに署名や透かしを入れたい場合は、アップロードする前に入れてください。',
      },
    ],
  },
  privacy: {
    title: 'プライバシーポリシー',
    sections: [
      {
        title: '1. 管理者',
        body: `${LEGAL_OWNER_NAME}（以下「当方」）は、モバイルアプリ「Immersa」を開発・運営しており、ユーザーの個人データの管理者です。本ポリシーでは、どのようなデータを収集し、何のために利用し、ユーザーが何をできるかを説明します。Immersaを利用することで、ここに記載された内容に同意したものとみなされます。`,
      },
      {
        title: '2. 収集するデータ',
        body: 'アカウント情報：メールアドレス、ユーザー名、パスワード（暗号化されており、当方は見ることができません）、生年月日。\n\nご自身で追加するプロフィール情報：写真、自己紹介、メールアドレスを公開するかどうか。\n\n公開するコンテンツ：作品、章、画像、音声、コメント。\n\nアプリ内の活動：保存した作品や読んでいる作品とその進み具合、しおり、いいね、フォローしている作者、お知らせ。\n\n技術的なデータ：アプリが利用するGoogleのサービスが、IPアドレス、端末の機種、OSのバージョンなど、サービス提供に必要なデータを自動的に記録することがあります。',
      },
      {
        title: '3. 利用目的',
        body: 'アプリを機能させるためだけに利用します。本人の識別、読書の進み具合の保存、あなたのコンテンツの他の読者への表示、新着のお知らせ（新しい章、コメント、運営からのお知らせ）、18歳以上向けコンテンツのための年齢確認、各作者への作品の集計データの表示、コンテンツのモデレーションです。データを販売することはなく、広告に利用することもありません。本アプリには、解析ツールや広告用のトラッキングツールは含まれていません。',
      },
      {
        title: '4. 他の人に見えるもの',
        body: '公開されるもの：ユーザー名、写真、自己紹介、公開した作品、コメント、役職がある場合はそのバッジ。これらは他のユーザーのほか、アカウントなしでウェブ版を訪れた人にも表示され、検索エンジンに表示されることがあります。メールアドレスは、設定で有効にした場合にのみ表示され、その場合は公開情報となります。\n\n非公開のもの：生年月日、本棚、読書の進み具合、しおり、お知らせ。作者は自分の作品を読んでいる人数や保存している人数を見ることができますが、それが誰であるかは分かりません。',
      },
      {
        title: '5. 保存場所と第三者のサービス',
        body: 'データは、Googleのサービスである Firebase（認証、データベース、ファイルの保存、ウェブ版のホスティング）に保存されます。Firebaseは技術的な提供者として機能し、法令で求められる保護措置のもと、あなたの国の外にあるサーバーでデータを処理することがあります。Androidでは、動作に必要な Google Play 開発者サービスも利用します。ウェブ版は Google Fonts から書体を読み込み、ログイン状態と読書設定を保持するために必要なデータをブラウザに保存します。広告用やトラッキング用のCookieは使用しません。\n\nデータの取り扱いについては、Googleのプライバシーポリシー（https://policies.google.com/privacy）および Firebase のプライバシーとセキュリティのページ（https://firebase.google.com/support/privacy）をご覧ください。\n\n一部の設定（読書テーマ、文字サイズ、下書き）は、お使いの端末にのみ保存されます。',
      },
      {
        title: '6. アプリが求める権限',
        body: '通知：新着（新しい章、コメント、運営からのお知らせ）をお知らせするためです。通知は、お使いの端末が新着を確認した際に端末自身が作成するもので、システムの設定からいつでもオフにできます。\n\n画像ギャラリー：プロフィール画像、表紙、作品の背景を選ぶときだけ利用します。アプリがアクセスするのは、あなたが選んだ画像だけです。\n\n音声ファイル：作品の音楽や効果音を選ぶときだけ利用します。\n\nアプリが勝手に写真やファイルにアクセスすることはありません。アクセスするのはあなたが選んだものだけで、追加したときにのみアップロードされます。',
      },
      {
        title: '7. 外部のコンテンツとリンク',
        body: '作者は、外部のサービスに置かれた画像や音声（たとえば Google ドライブのリンク）を作品に含めることができます。そのような作品を読む際、お使いの端末はそれらのサービスに接続してダウンロードを行い、そのサービスがIPアドレスなどの技術的なデータを記録することがあります。これらのサイトは当方が運営するものではなく、それぞれのプライバシーポリシーが適用されます。',
      },
      {
        title: '8. セキュリティ',
        body: 'データを保護するため、合理的な対策を講じています。通信は暗号化され、パスワードは暗号化して保存され、情報へのアクセスはセキュリティルールによって制限されています（たとえば、あなたの本棚や生年月日を他の人が読むことはできません）。ただし、インターネット上の通信や電子的な保存に100%安全な方法はなく、絶対的な安全を保証することはできません。',
      },
      {
        title: '9. 保存期間',
        body: 'アカウントをお持ちの間、保存します。「プロフィール → 設定」からアカウントを削除すると、プロフィール、作品、本棚、お知らせ、いいねが削除されます。他の人の作品に残したコメントは残る場合があります。削除をご希望の場合はご連絡ください。',
      },
      {
        title: '10. あなたの権利',
        body: `ご自身のデータへのアクセス、訂正、削除の依頼、利用への異議申し立て、写しの請求ができます。その多くはアプリ内でご自身で行えます。それ以外については ${LEGAL_CONTACT_EMAIL} までご連絡ください。また、お住まいの国のデータ保護機関に申し立てを行う権利もあります。`,
      },
      {
        title: '11. 未成年者',
        body: `本アプリは${MIN_AGE}歳未満の方を対象としておらず、その年齢未満でのアカウント作成は認められていません。その年齢未満の方からデータの提供を受けたことが判明した場合は、アカウントを削除します。18歳以上向けとして設定されたコンテンツは、${ADULT_AGE}歳以上のユーザーにのみ表示されます。`,
      },
      {
        title: '12. 本ポリシーの変更とお問い合わせ',
        body: `データの取り扱い方法が変わる場合は、本ポリシーを更新し、重要な変更についてはアプリ内でお知らせします。本ポリシーについてのご質問は ${LEGAL_CONTACT_EMAIL} までご連絡ください。`,
      },
    ],
  },
};

export const legalDocs = (lang: Lang): Docs => (lang === 'en' ? EN : lang === 'ja' ? JA : LEGAL_DOCS);
