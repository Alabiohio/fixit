import { Info } from 'lucide-react';
import { formatNaira } from '../../shared/constants';
import type { PriceEstimateResult } from '../types/FixIt';

interface PriceEstimateCardProps {
  estimate: PriceEstimateResult;
}

export function PriceEstimateCard({ estimate }: PriceEstimateCardProps) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <div className="text-xs font-medium text-[#6B7280]">
          FixIt Intelligence · {estimate.dataQuality}
        </div>
        {estimate.isProvisional && (
          <span className="text-xs font-medium text-[#FF6B35]">
            Provisional indicative estimate
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-slate-100">
        <div>
          <div className="text-xs text-[#6B7280] mb-1">Estimated price range</div>
          <div className="text-2xl font-bold text-[#FF6B35] font-mono-nums">
            {formatNaira(estimate.estimatedMin)} – {formatNaira(estimate.estimatedMax)}
          </div>
        </div>
        <div>
          <div className="text-xs text-[#6B7280] mb-1">
            Indicative deposit (final is 20% of agreed price)
          </div>
          <div className="text-2xl font-bold text-[#FF6B35] font-mono-nums">
            {formatNaira(estimate.suggestedDeposit)}
          </div>
        </div>
      </div>

      <p className="text-sm text-[#1A1B25] leading-relaxed mt-4">
        {estimate.explanation}
      </p>

      {(estimate.assumptions.length > 0 || estimate.priceDrivers.length > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-100 text-xs text-[#6B7280]">
          {estimate.assumptions.length > 0 && (
            <div>
              <div className="font-semibold text-[#1A1B25] mb-1.5">Assumptions</div>
              <ul className="space-y-1 list-disc list-inside">
                {estimate.assumptions.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}
          {estimate.priceDrivers.length > 0 && (
            <div>
              <div className="font-semibold text-[#1A1B25] mb-1.5">What can change the price</div>
              <ul className="space-y-1 list-disc list-inside">
                {estimate.priceDrivers.map((item, idx) => (
                  <li key={idx}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 text-xs text-[#6B7280] bg-[#F6F7FB] rounded-lg p-3">
        <Info className="w-4 h-4 text-[#FF6B35] shrink-0 mt-0.5" />
        <span>{estimate.disclaimer}</span>
      </div>
    </div>
  );
}
