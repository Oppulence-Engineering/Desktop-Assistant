import { EdgeFade } from '../edge-fade'
import { TablesRecordsTable } from './tables-records-table'

interface TablesRecordsPreviewProps {
  layout?: 'hero' | 'stage'
}

/** Interactive register surface — hero offset or centered stage fill. */
export function TablesRecordsPreview({ layout = 'hero' }: TablesRecordsPreviewProps) {
  if (layout === 'stage') {
    return (
      <div className='relative isolate size-full overflow-hidden bg-[var(--bg)]'>
        <div className='flex size-full items-center justify-center px-4 py-2'>
          <div className='h-full max-h-[440px] w-full max-w-[780px] overflow-hidden rounded-[10px] border border-[var(--border)] shadow-xs'>
            <TablesRecordsTable />
          </div>
        </div>
        <EdgeFade depth='preview' edges={['top', 'left', 'right', 'bottom']} ground='canvas' />
      </div>
    )
  }

  return (
    <div className='absolute inset-0 isolate overflow-hidden bg-[var(--bg)]'>
      <div className='-translate-x-1/2 absolute top-20 left-1/2 h-[440px] w-[780px] max-w-[calc(100%_-_48px)] max-sm:top-8 max-sm:h-[410px]'>
        <div className='h-full overflow-hidden rounded-[10px] border border-[var(--border)] shadow-xs'>
          <TablesRecordsTable />
        </div>
        <EdgeFade depth='stage' edges={['bottom']} ground='canvas' />
      </div>
      <EdgeFade depth='preview' edges={['top', 'left', 'right']} ground='canvas' />
    </div>
  )
}
