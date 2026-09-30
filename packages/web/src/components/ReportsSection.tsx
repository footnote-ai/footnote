/**
 * @description: Renders account-linked reports and the form used to claim one.
 * @footnote-scope: web
 * @footnote-module: ReportsSection
 * @footnote-risk: low - Displays reporter-safe report details and delegates claims to the account page.
 * @footnote-ethics: medium - Account linkage and claim feedback affect user control of report associations.
 */

import type { FormEvent } from 'react';
import type { GetAccountIncidentsResponse } from '@footnote/contracts/web';

export type ReportReadState = 'loading' | 'ready' | 'error';

type ReportsSectionProps = {
    incidents: GetAccountIncidentsResponse['incidents'];
    readState: ReportReadState;
    claimCode: string;
    claimMessage: string;
    onClaimCodeChange: (value: string) => void;
    onClaim: (event: FormEvent<HTMLFormElement>) => void;
};

const ReportsSection = ({
    incidents,
    readState,
    claimCode,
    claimMessage,
    onClaimCodeChange,
    onClaim,
}: ReportsSectionProps): JSX.Element => (
    <section
        className="account-page__section"
        aria-labelledby="account-incidents-heading"
    >
        <h2 id="account-incidents-heading">Reports</h2>
        <p>Use a claim code to add a report to your account.</p>
        <form
            className="account-page__claim-form"
            onSubmit={(event) => onClaim(event)}
        >
            <label htmlFor="incident-claim-code">Claim code</label>
            <input
                id="incident-claim-code"
                autoComplete="off"
                maxLength={43}
                required
                value={claimCode}
                onChange={(event) => onClaimCodeChange(event.target.value)}
            />
            <button
                className="account-page__action account-page__action--primary"
                type="submit"
                disabled={!claimCode.trim()}
            >
                Add report
            </button>
        </form>
        {claimMessage ? <p role="status">{claimMessage}</p> : null}
        {readState === 'loading' ? <p role="status">Loading reports…</p> : null}
        {readState === 'error' ? (
            <p className="account-page__error" role="alert">
                Reports could not be loaded. Please try again.
            </p>
        ) : null}
        {readState === 'ready' && incidents.length === 0 ? (
            <p>No reports are linked to your account.</p>
        ) : null}
        {readState === 'ready' && incidents.length > 0 ? (
            <ul className="account-page__report-list">
                {incidents.map((incident) => (
                    <li key={incident.incidentId}>
                        <h3>Report {incident.incidentId}</h3>
                        <p>
                            {incident.status.replaceAll('_', ' ')}
                            {' · '}Submitted{' '}
                            <time dateTime={incident.createdAt}>
                                {new Date(
                                    incident.createdAt
                                ).toLocaleDateString(undefined, {
                                    dateStyle: 'medium',
                                })}
                            </time>
                            {' · '}Updated{' '}
                            <time dateTime={incident.updatedAt}>
                                {new Date(
                                    incident.updatedAt
                                ).toLocaleDateString(undefined, {
                                    dateStyle: 'medium',
                                })}
                            </time>
                        </p>
                    </li>
                ))}
            </ul>
        ) : null}
    </section>
);

export default ReportsSection;
