import { cleanupFixture } from './create-fixture';

export default function globalTeardown() {
  cleanupFixture();
}
