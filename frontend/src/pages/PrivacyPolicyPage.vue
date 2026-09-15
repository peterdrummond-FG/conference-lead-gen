<template>
  <q-page class="q-pa-lg flex flex-center">
    <router-link to="/login" class="app-logo-link">CKH Connect</router-link>
    <q-card style="width: 720px; max-width: 92vw" class="q-pa-md">
      <q-card-section>
        <div class="text-h5">Privacy Policy</div>
        <div class="text-caption text-grey">Flippen Group CKH Connect</div>
        <div class="text-caption text-grey">Last updated September 2026</div>
      </q-card-section>

      <q-card-section class="text-body2 q-gutter-md">
        <p>
          Flippen Group understands that your privacy is important to you, and we are committed to
          protecting the personally-identifiable information collected through this application
          ("the Site") — including the public conference intake form, the business-card and voice-memo
          submissions made by our field sales representatives, and the "Flippen Group Conference Lead
          Capture" SMS program described below.
        </p>

        <div>
          <div class="text-subtitle2 text-weight-bold">Information We Collect</div>
          <p>
            Conference attendees who submit the intake form provide us their name, email address, phone
            number, title, and school/school-district affiliation. Our field sales representatives
            additionally submit photographs of business cards and voice-memo audio (and its transcript)
            they collect at conferences, and their own mobile phone number when using the SMS program.
            The Site also collects standard technical data such as IP address and browsing activity.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">How We Use Information</div>
          <p>
            We use this information to operate the Site — associating submitted contacts with the
            correct conference, matching them against our customer relationship management system, and
            operating the SMS program — and to follow up with conference attendees regarding the events
            they engaged with.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Cookies</div>
          <p>
            Cookies are small packets of information stored by your web browser. The Site may use them
            to keep you signed in and to remember your preferences. You can inspect, delete, or block
            cookies through your browser's settings.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">SMS / Text Messaging Data</div>
          <p>
            Representatives opt in to the Flippen Group Conference Lead Capture SMS program by texting
            <span class="text-weight-bold">SETUP</span> to
            <span class="text-weight-bold">+1 (936) 218-1311</span>
            (or, once a conference is active, by texting that day's event code directly to the same
            number). By texting SETUP or the event code, the representative agrees to receive recurring
            automated text messages from Flippen Group related to conference lead capture. Msg&amp;data
            rates may apply. Msg frequency varies. Reply HELP for help, STOP to cancel.
          </p>
          <p>
            Text messaging originator opt-in data and consent for the Flippen Group Conference Lead
            Capture SMS program is not shared with any third parties for any purpose. Mobile phone
            numbers collected through this program are used solely to operate the program and are not
            sold, rented, or shared with third parties or affiliates for their own marketing or
            promotional purposes.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Third-Party Disclosure</div>
          <p>
            We do not sell or rent your information to third parties. We may share information with
            vendors who agree to maintain its confidentiality and use it only to help us operate the
            Site, or when required to do so by a court order or other legal process.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Data Access and Security</div>
          <p>
            You can request access to, correction of, or deletion of your information by contacting us
            below. We maintain reasonable administrative, technical, and physical safeguards designed to
            protect the information we collect, though no method of transmission or storage is
            completely secure and we cannot guarantee absolute security.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Children's Privacy</div>
          <p>
            The Site is not designed for or directed at children 13 years of age or younger, and we do
            not knowingly collect personal information from children through it.
          </p>
        </div>

        <div>
          <div class="text-subtitle2 text-weight-bold">Contact Us</div>
          <p>
            Questions about this Privacy Policy can be directed to:<br />
            Flippen Group Legal Department<br />
            1199 Haywood Drive, College Station, TX 77845<br />
            979-693-7660
          </p>
        </div>

        <p class="text-caption text-grey">
          See also our <router-link to="/terms">Terms &amp; Conditions</router-link>.
        </p>
      </q-card-section>
    </q-card>
  </q-page>
</template>

<style scoped>
.app-logo-link {
  position: fixed;
  top: 16px;
  left: 16px;
  font-weight: 700;
  color: var(--q-primary);
  text-decoration: none;
}
</style>
